import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { keccak256, type Hex, getContractAddress } from "viem";
import { z } from "zod";
import { FrameShrinkError } from "./shared.js";
import {
  readDemoDevnet,
  submitDemoDeployment,
  DevnetRpcError,
  verifyDevnet,
} from "./devnet.js";
import {
  walletStatus,
  signDemoDeployment,
  activeWalletDirectory,
} from "./wallet.js";
import { validatorRuntime } from "./validator-code.js";

const schema = z
  .object({
    schemaVersion: z.literal(1),
    owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    raw: z.string().regex(/^0x[0-9a-fA-F]+$/),
    state: z.enum(["pending", "confirmed"]),
    receipt: z.unknown().optional(),
  })
  .strict();
async function save(file: string, value: unknown) {
  await writeFile(file + ".tmp", JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(file + ".tmp", file);
}
export async function ensureDemoValidator(
  options: {
    version?: import("./validator-code.js").ValidatorVersion;
    beforeDeploy?: () => Promise<boolean>;
  } = {},
) {
  const version = options.version ?? 1;
  const file = path.join(
    activeWalletDirectory(),
    version === 1 ? "validator.json" : `validator-v${version}.json`,
  );
  await verifyDevnet(readDemoDevnet);
  const wallet = await walletStatus({ offline: true });
  let record: z.infer<typeof schema> | null = null;
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) throw Error("invalid");
    record = parsed.data;
    if (
      record.owner !== wallet.address ||
      keccak256(record.raw as Hex) !== record.hash
    )
      throw Error("mismatch");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new FrameShrinkError(
        "Validator deployment record is invalid; no replacement was sent",
        3,
      );
  }
  if (!record) {
    if (options.beforeDeploy && !(await options.beforeDeploy()))
      throw new FrameShrinkError("Cancelled before validator deployment", 0);
    const [nonceValue, head]: any[] = await Promise.all([
      readDemoDevnet("eth_getTransactionCount", [wallet.address, "latest"]),
      readDemoDevnet("eth_getBlockByNumber", ["latest", false]),
    ]);
    if (typeof nonceValue !== "string" || !/^0x[0-9a-f]+$/i.test(nonceValue))
      throw new FrameShrinkError("Deployment nonce is unavailable", 4);
    const nonce = BigInt(nonceValue),
      maxFee = 2n * BigInt(head.baseFeePerGas ?? "0x0") + 1000000000n;
    const raw = await signDemoDeployment(
        nonce,
        maxFee,
        activeWalletDirectory(),
        version,
      ),
      hash = keccak256(raw),
      address = getContractAddress({ from: wallet.address as Hex, nonce });
    record = {
      schemaVersion: 1,
      owner: wallet.address,
      address,
      hash,
      raw,
      state: "pending",
    };
    await save(file, record);
    try {
      const result = await submitDemoDeployment(raw);
      if (result !== hash)
        throw new FrameShrinkError("Unexpected validator deployment hash", 4);
    } catch (e) {
      if (!(e instanceof DevnetRpcError) || !e.uncertain) throw e;
    }
  }
  const deadline = Date.now() + 30000;
  do {
    let receipt: any = null;
    try {
      receipt = await readDemoDevnet("eth_getTransactionReceipt", [
        record.hash,
      ]);
    } catch {}
    if (receipt) {
      if (
        receipt.status !== "0x1" ||
        receipt.transactionHash?.toLowerCase() !== record.hash.toLowerCase() ||
        receipt.contractAddress?.toLowerCase() !== record.address.toLowerCase()
      )
        throw new FrameShrinkError("Validator deployment did not succeed", 5);
      const code = await readDemoDevnet("eth_getCode", [
        record.address,
        "latest",
      ]);
      if (code !== validatorRuntime(wallet.address, version))
        throw new FrameShrinkError(
          "Deployed validator code differs from the fixture",
          5,
        );
      record = { ...record, state: "confirmed", receipt };
      await save(file, record);
      return record;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) =>
      setTimeout(r, Math.min(2000, deadline - Date.now())),
    );
  } while (Date.now() <= deadline);
  throw new FrameShrinkError(
    "Validator deployment pending; run demo again to check the same transaction",
    4,
  );
}
