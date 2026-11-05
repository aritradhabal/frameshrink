import { MAX_FAILURE_MASK } from "./failure-modes.js";
import { z } from "zod";
import { encodeFunctionData, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeSigHash,
  encodeRawFrameTx,
} from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import type {
  FrameTransaction,
  Frame,
} from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
import { FrameShrinkError } from "./shared.js";
const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const RecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("owned"),
    family: z.enum(["verify-gas", "banned-opcode", "validation-fixture"]),
    failureMask: z.number().int().min(1).max(MAX_FAILURE_MASK).optional(),
    opcodeMask: z.number().int().min(1).max(3).optional(),
    name: id,
    prefixGas: z.number().int().min(10000).max(200000),
    body: z
      .array(
        z
          .object({
            id,
            required: z.boolean(),
            values: z.array(z.number().int().min(0).max(1000000)).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (
      (x.family === "validation-fixture" && x.failureMask === undefined) ||
      (x.failureMask !== undefined && x.opcodeMask !== undefined) ||
      (x.family === "banned-opcode" && x.failureMask !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Failure modes need a v3 fixture mask; legacy opcode masks cannot be mixed",
      });
    if (new Set(x.body.map((b) => b.id)).size !== x.body.length)
      ctx.addIssue({ code: "custom", message: "Duplicate stable frame IDs" });
    if (!x.body.some((b) => b.required))
      ctx.addIssue({
        code: "custom",
        message: "At least one required body frame is needed",
      });
  });
export type Recipe = z.infer<typeof RecipeSchema>;
export function parseRecipe(v: unknown): Recipe {
  const r = RecipeSchema.safeParse(v);
  if (!r.success) throw new FrameShrinkError(r.error.message, 2);
  return r.data;
}
export const WALLET = "0x00000000000000000000000000000000c0ffee03" as const;
export const BANNED = "0x00000000000000000000000000000000badc0de1" as const;
export const SINK = "0x00000000000000000000000000000000c0ffee04" as const;
export const ABI = [
  {
    type: "function",
    name: "consume",
    stateMutability: "pure",
    inputs: [{ name: "values", type: "uint256[]" }],
    outputs: [{ name: "total", type: "uint256" }],
  },
] as const;
// Public disposable test material. This signer is never funded and is restricted to the owned local genesis.
const account = privateKeyToAccount(
  keccak256(
    stringToHex("FrameShrink local fixture signer v1 — disposable, never fund"),
  ),
);
export async function build(
  recipe: Recipe,
): Promise<{ tx: FrameTransaction; raw: Hex; frameIds: string[] }> {
  if (
    recipe.opcodeMask !== undefined ||
    recipe.failureMask !== undefined ||
    recipe.family === "validation-fixture"
  )
    throw new FrameShrinkError(
      "Mode-selected fixtures require captured owner-bound validator state",
      2,
    );
  const prefix: Frame = {
    mode: 1,
    flags: 3,
    target: null,
    limits: { execution: BigInt(recipe.prefixGas), state: 0n },
    value: 0n,
    data: "0x",
  };
  const tx: FrameTransaction = {
    chainId: 9n,
    nonceKeys: [0n],
    nonceSeq: 1n,
    sender: recipe.family === "banned-opcode" ? BANNED : WALLET,
    frames: [
      prefix,
      ...recipe.body.map((b) => ({
        mode: 2 as const,
        flags: 0,
        target: SINK,
        limits: { execution: 100000n, state: 0n },
        value: 0n,
        data: encodeFunctionData({
          abi: ABI,
          functionName: "consume",
          args: [b.values.map(BigInt)],
        }),
      })),
    ],
    signatures: [
      { scheme: 1, signer: account.address, msg: "0x", signature: "0x" },
    ],
    fees: {
      maxPriorityFeePerGas: 1000000000n,
      maxFeePerGas: 2000000000n,
      maxFeePerBlobGas: 0n,
    },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
  const signature = await account.sign({ hash: computeSigHash(tx) });
  const recovery = Number.parseInt(signature.slice(-2), 16) - 27;
  tx.signatures[0].signature = `0x${recovery.toString(16).padStart(2, "0")}${signature.slice(2, -2)}`;
  return {
    tx,
    raw: encodeRawFrameTx(tx),
    frameIds: ["validation", ...recipe.body.map((b) => b.id)],
  };
}
export type Edit =
  | { kind: "remove-frames"; ids: string[] }
  | { kind: "remove-values"; id: string; start: number; count: number };
export function applyEdit(recipe: Recipe, edit: Edit): Recipe {
  const x = structuredClone(recipe);
  if (edit.kind === "remove-frames") {
    if (edit.ids.some((id) => x.body.find((b) => b.id === id)?.required))
      throw new FrameShrinkError("Cannot remove required frame", 2);
    x.body = x.body.filter((b) => !edit.ids.includes(b.id));
  } else {
    const b = x.body.find((b) => b.id === edit.id);
    if (
      !b ||
      edit.start < 0 ||
      edit.count < 1 ||
      edit.start + edit.count > b.values.length
    )
      throw new FrameShrinkError("Invalid typed array edit", 2);
    b.values.splice(edit.start, edit.count);
  }
  return parseRecipe(x);
}
export function neighbors(r: Recipe): Edit[] {
  return [
    ...r.body
      .filter((b) => !b.required)
      .map((b) => ({ kind: "remove-frames" as const, ids: [b.id] })),
    ...r.body.flatMap((b) =>
      b.values.map((_, i) => ({
        kind: "remove-values" as const,
        id: b.id,
        start: i,
        count: 1,
      })),
    ),
  ];
}
