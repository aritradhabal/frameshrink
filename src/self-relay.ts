import {
  encodeAbiParameters,
  decodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";
import type { FrameTransaction } from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
import {
  computeSigHash,
  encodeRawFrameTx,
} from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import { parseRecipe, type Recipe } from "./recipe.js";
import { FrameShrinkError } from "./shared.js";
import { z } from "zod";
import { recipeMask, MAX_FAILURE_MASK } from "./failure-modes.js";
import { validatorRuntime } from "./validator-code.js";
const quantity = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .max(66);
export const ContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainId: z.literal(1337),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    nonce: quantity,
    balance: quantity,
    code: z.literal("0x"),
    maxFeePerGas: quantity,
    maxPriorityFeePerGas: quantity,
    blockNumber: quantity,
    blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    validator: z
      .object({
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        nonce: quantity,
        balance: quantity,
        code: z
          .string()
          .regex(/^0x[0-9a-f]+$/i)
          .max(1024),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.validator &&
      ![
        validatorRuntime(c.address),
        validatorRuntime(c.address, 2),
        validatorRuntime(c.address, 3),
      ].includes(c.validator.code as Hex)
    )
      ctx.addIssue({
        code: "custom",
        message: "Validator bytecode is not bound to the captured owner",
      });
  });
export type CaseContext = z.infer<typeof ContextSchema>;
export function unsignedSelfRelay(
  recipe: Recipe,
  context: CaseContext,
): FrameTransaction {
  parseRecipe(recipe);
  ContextSchema.parse(context);
  const validator = context.validator;
  if (
    recipe.opcodeMask !== undefined &&
    validator?.code !== validatorRuntime(context.address, 2)
  )
    throw new FrameShrinkError(
      "Opcode mask requires the owned v2 validator",
      3,
    );
  if (
    recipe.failureMask !== undefined &&
    validator?.code !== validatorRuntime(context.address, 3)
  )
    throw new FrameShrinkError(
      "Failure mask requires the owned v3 validator",
      3,
    );
  return {
    chainId: 1337n,
    nonceKeys: [0n],
    nonceSeq: BigInt(validator?.nonce ?? context.nonce),
    sender: (validator?.address ?? context.address) as Hex,
    frames: [
      {
        mode: 1,
        flags: 3,
        target: null,
        limits: { execution: BigInt(recipe.prefixGas), state: 0n },
        value: 0n,
        data: validator
          ? encodeAbiParameters(
              [{ type: "uint256" }],
              [BigInt(recipeMask(recipe))],
            )
          : "0x",
      },
      ...recipe.body.map((b) => ({
        mode: 2 as const,
        flags: 0,
        target: context.address as Hex,
        limits: { execution: 100000n, state: 0n },
        value: 0n,
        data: encodeAbiParameters(
          [{ type: "uint256[]" }],
          [b.values.map(BigInt)],
        ),
      })),
    ],
    signatures: [
      {
        scheme: 1,
        signer: validator ? (context.address as Hex) : "0x",
        msg: "0x",
        signature: "0x",
      },
    ],
    fees: {
      maxPriorityFeePerGas: BigInt(context.maxPriorityFeePerGas),
      maxFeePerGas: BigInt(context.maxFeePerGas),
      maxFeePerBlobGas: 0n,
    },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}
export function assertSelfRelay(tx: FrameTransaction, address?: string) {
  const fail = () => {
    throw new FrameShrinkError(
      "Only the fixed chain-1337 zero-value self-relay demo can be signed or submitted",
      3,
    );
  };
  if (tx.signatures.length !== 1) fail();
  const sig = tx.signatures[0];
  const owner = sig.signer === "0x" ? tx.sender : sig.signer;
  const contract = owner.toLowerCase() !== tx.sender.toLowerCase();
  if (
    tx.chainId !== 1337n ||
    (address && owner.toLowerCase() !== address.toLowerCase()) ||
    !/^0x[0-9a-f]{40}$/i.test(owner) ||
    tx.nonceKeys.length !== 1 ||
    tx.nonceKeys[0] !== 0n ||
    tx.nonceSeq < 0n ||
    tx.nonceSeq >= (1n << 64n) - 1n ||
    tx.frames.length < 2 ||
    tx.frames.length > 4 ||
    tx.blobVersionedHashes.length ||
    tx.recentRootReferences.length
  )
    fail();
  const prefix = tx.frames[0];
  if (
    sig.scheme !== 1 ||
    sig.msg !== "0x" ||
    prefix.mode !== 1 ||
    prefix.flags !== 3 ||
    prefix.target !== null ||
    prefix.value !== 0n ||
    prefix.limits.state !== 0n ||
    ![30000n, 120000n].includes(prefix.limits.execution) ||
    tx.fees.maxFeePerGas <= 0n ||
    tx.fees.maxFeePerGas > 100000000000n ||
    tx.fees.maxPriorityFeePerGas < 0n ||
    tx.fees.maxPriorityFeePerGas > tx.fees.maxFeePerGas ||
    tx.fees.maxFeePerBlobGas !== 0n
  )
    fail();
  if (contract) {
    if (
      prefix.limits.execution !== 30000n ||
      !Array.from({ length: MAX_FAILURE_MASK + 1 }, (_, index) => index)
        .map((v) => "0x" + v.toString(16).padStart(64, "0"))
        .includes(prefix.data)
    )
      fail();
  } else if (prefix.data !== "0x") fail();
  for (const frame of tx.frames.slice(1)) {
    if (
      frame.mode !== 2 ||
      frame.flags !== 0 ||
      frame.target?.toLowerCase() !== owner.toLowerCase() ||
      frame.value !== 0n ||
      frame.limits.execution !== 100000n ||
      frame.limits.state !== 0n ||
      frame.data.length > 8400
    )
      fail();
    try {
      const [values] = decodeAbiParameters([{ type: "uint256[]" }], frame.data);
      if (
        values.length > 128 ||
        values.some((v) => v > 1000000n) ||
        encodeAbiParameters([{ type: "uint256[]" }], [values]) !== frame.data
      )
        fail();
    } catch {
      fail();
    }
  }
}
export function caseFrameIds(recipe: Recipe, context: CaseContext) {
  return ["validation", ...recipe.body.map((b) => b.id)];
}
export function transactionHash(tx: FrameTransaction) {
  return keccak256(encodeRawFrameTx(tx));
}
export { computeSigHash, encodeRawFrameTx };
