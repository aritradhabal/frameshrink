import { constants } from "node:fs";
import { mkdir, open, rename, lstat, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatEther, type Hex } from "viem";
import { z } from "zod";
import { DATA_DIRECTORY, FrameShrinkError } from "./shared.js";
import {
  DEVNET,
  DevnetRpcError,
  readDevnet,
  requestSponsorFaucet,
  verifyDevnet,
  type DevnetReader,
} from "./devnet.js";
export const DEFAULT_DIRECTORY = path.join(DATA_DIRECTORY, "wallet");
const WalletSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("frameshrink-devnet-wallet"),
    chainId: z.literal(1337),
    createdAt: z.string().datetime(),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();
type StoredWallet = z.infer<typeof WalletSchema>;
export type WalletIdentity = {
  schemaVersion: 1;
  address: string;
  chainId: 1337;
  network: string;
  createdAt: string;
  custody: "local development key; mode 0600";
  scope: "sponsor devnet only; no website authentication";
};
async function directorySafe(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw new FrameShrinkError(
      "Wallet directory must be private (mode 0700) and must not be a symlink",
      3,
    );
}
async function readPrivateJSON(file: string) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > 16384 ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      throw Error("permissions");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle?.close();
  }
}
async function writePrivateJSON(file: string, value: unknown, create = false) {
  const temp = create ? file : `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!create) await rename(temp, file);
  } catch (e) {
    await handle?.close();
    if (!create) await unlink(temp).catch(() => {});
    throw e;
  }
}
async function storedWallet(directory: string): Promise<StoredWallet> {
  await directorySafe(directory);
  try {
    const parsed = WalletSchema.safeParse(
      await readPrivateJSON(path.join(directory, "key.json")),
    );
    if (!parsed.success) throw Error("invalid");
    const wallet = parsed.data;
    if (
      privateKeyToAccount(wallet.privateKey as Hex).address !== wallet.address
    )
      throw Error("mismatch");
    return wallet;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new FrameShrinkError(
        "No active test wallet. Run frameshrink wallet create.",
        3,
      );
    throw new FrameShrinkError(
      "Wallet file is invalid or insecure. It was not replaced. Private material is omitted from this error.",
      3,
    );
  }
}
const identity = (wallet: StoredWallet): WalletIdentity => ({
  schemaVersion: 1,
  address: wallet.address,
  chainId: 1337,
  network: DEVNET.name,
  createdAt: wallet.createdAt,
  custody: "local development key; mode 0600",
  scope: "sponsor devnet only; no website authentication",
});
export async function createWallet(
  directory = activeWalletDirectory(),
): Promise<WalletIdentity & { created: boolean }> {
  await directorySafe(directory);
  try {
    return { ...identity(await storedWallet(directory)), created: false };
  } catch (e) {
    if (
      !(e instanceof FrameShrinkError) ||
      !e.message.startsWith("No active test wallet")
    )
      throw e;
  }
  const privateKey = generatePrivateKey();
  const wallet: StoredWallet = {
    schemaVersion: 1,
    kind: "frameshrink-devnet-wallet",
    chainId: 1337,
    address: privateKeyToAccount(privateKey).address,
    createdAt: new Date().toISOString(),
    privateKey,
  };
  try {
    await writePrivateJSON(path.join(directory, "key.json"), wallet, true);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      return { ...identity(await storedWallet(directory)), created: false };
    throw new FrameShrinkError(
      "Could not store the new test wallet securely",
      4,
    );
  }
  return { ...identity(wallet), created: true };
}
const FaucetSchema = z
  .object({
    schemaVersion: z.literal(1),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    endpoint: z.literal(DEVNET.rpc),
    requestedAt: z.string().datetime(),
    state: z.enum([
      "requesting",
      "pending",
      "confirmed",
      "reverted",
      "rejected",
      "unknown",
    ]),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    amountWei: z.string().regex(/^\d+$/).nullable(),
    balanceBeforeWei: z.string().regex(/^\d+$/),
    error: z.string().max(1024).nullable(),
    receipt: z.unknown().optional(),
  })
  .strict();
export type FaucetRecord = z.infer<typeof FaucetSchema>;
async function readFaucet(directory: string): Promise<FaucetRecord | null> {
  try {
    const parsed = FaucetSchema.safeParse(
      await readPrivateJSON(path.join(directory, "faucet.json")),
    );
    if (!parsed.success) throw Error();
    return parsed.data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new FrameShrinkError(
      "Faucet history is invalid; refusing an automatic repeat request",
      3,
    );
  }
}
async function balance(address: string, reader: DevnetReader) {
  const value = await reader("eth_getBalance", [address, "latest"]);
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    value.length > 66
  )
    throw new FrameShrinkError("Malformed balance response", 4);
  return BigInt(value);
}
export async function walletStatus(
  options: {
    offline?: boolean;
    directory?: string;
    reader?: DevnetReader;
  } = {},
) {
  const directory = options.directory ?? activeWalletDirectory();
  const wallet = await storedWallet(directory);
  const faucet = await readFaucet(directory);
  if (faucet && faucet.address !== wallet.address)
    throw new FrameShrinkError(
      "Faucet history belongs to a different wallet",
      3,
    );
  const base = { ...identity(wallet), faucet };
  if (options.offline)
    return {
      ...base,
      networkChecked: false,
      balanceWei: null,
      balanceEth: null,
    };
  const reader = options.reader ?? readDevnet;
  await verifyDevnet(reader);
  const value = await balance(wallet.address, reader);
  return {
    ...base,
    networkChecked: true,
    balanceWei: value.toString(),
    balanceEth: formatEther(value),
  };
}
export async function exclusiveWallet<T>(
  directory: string,
  fn: () => Promise<T>,
) {
  await directorySafe(directory);
  let handle;
  const file = path.join(directory, "operation.lock");
  try {
    handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new FrameShrinkError(
      "Another wallet operation is active; no faucet request was sent",
      4,
    );
  }
  try {
    await handle.writeFile(String(process.pid));
    return await fn();
  } finally {
    await handle.close();
    await unlink(file);
  }
}
export async function fundWallet(
  options: {
    directory?: string;
    reader?: DevnetReader;
    request?: (address: string) => Promise<unknown>;
    waitMs?: number;
    pollMs?: number;
    onSubmitted?: (hash: string) => void;
  } = {},
) {
  const directory = options.directory ?? activeWalletDirectory();
  const waitMs = options.waitMs ?? 30000;
  if (
    !Number.isFinite(waitMs) ||
    waitMs < 0 ||
    waitMs > 30000 ||
    (options.pollMs !== undefined &&
      (!Number.isFinite(options.pollMs) ||
        options.pollMs < 1 ||
        options.pollMs > 30000))
  )
    throw new FrameShrinkError(
      "Faucet wait must be 0–30000 ms; polling interval must be 1–30000 ms",
      2,
    );
  return exclusiveWallet(directory, async () => {
    const wallet = await storedWallet(directory),
      reader = options.reader ?? readDevnet;
    const node = await verifyDevnet(reader);
    let record = await readFaucet(directory);
    let requestedNow = false;
    if (record && record.address !== wallet.address)
      throw new FrameShrinkError("Faucet history belongs to another wallet", 3);
    const before = await balance(wallet.address, reader);
    // An uncertain or pending operation must be reconciled, never blindly repeated.
    const unresolved =
      record && ["requesting", "pending", "unknown"].includes(record.state);
    const cooling =
      record && Date.now() - Date.parse(record.requestedAt) < 3600000;
    if (!unresolved && !cooling) {
      if (!node.faucetEnabled)
        throw new FrameShrinkError(
          "Sponsor faucet is disabled on this node",
          3,
        );
      record = {
        schemaVersion: 1,
        address: wallet.address,
        endpoint: DEVNET.rpc,
        requestedAt: new Date().toISOString(),
        state: "requesting",
        txHash: null,
        amountWei: null,
        balanceBeforeWei: before.toString(),
        error: null,
      };
      await writePrivateJSON(path.join(directory, "faucet.json"), record);
      try {
        const response = await (options.request ?? requestSponsorFaucet)(
          wallet.address,
        );
        const parsed = z
          .object({
            txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            amount: z.string().regex(/^\d+$/).max(78),
          })
          .safeParse(response);
        if (!parsed.success || BigInt(parsed.data.amount) <= 0n)
          throw new DevnetRpcError(
            "Malformed faucet response; reconcile before retrying",
            true,
          );
        record = {
          ...record,
          state: "pending",
          txHash: parsed.data.txHash,
          amountWei: parsed.data.amount,
        };
        requestedNow = true;
        await writePrivateJSON(path.join(directory, "faucet.json"), record);
        options.onSubmitted?.(record.txHash!);
      } catch (e) {
        record = {
          ...record,
          state:
            e instanceof DevnetRpcError && !e.uncertain
              ? "rejected"
              : "unknown",
          error:
            e instanceof DevnetRpcError
              ? e.message
              : "Faucet request outcome unknown; no automatic repeat",
        };
        await writePrivateJSON(path.join(directory, "faucet.json"), record);
      }
    }
    if (!record) throw new FrameShrinkError("Missing faucet history", 4);
    const deadline = Date.now() + waitMs;
    if (
      record.txHash &&
      ["pending", "requesting", "unknown"].includes(record.state)
    ) {
      const expectedHash = record.txHash;
      do {
        try {
          const receipt = await reader("eth_getTransactionReceipt", [
            record.txHash,
          ]);
          if (receipt !== null) {
            const parsed = z
              .object({
                transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
                to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
                status: z.enum(["0x0", "0x1"]),
                blockNumber: z.string().regex(/^0x[0-9a-f]+$/i),
              })
              .passthrough()
              .safeParse(receipt);
            if (
              !parsed.success ||
              parsed.data.transactionHash.toLowerCase() !==
                expectedHash.toLowerCase() ||
              parsed.data.to.toLowerCase() !== wallet.address.toLowerCase()
            )
              throw new FrameShrinkError(
                "Faucet receipt does not match the expected transfer",
                4,
              );
            record = {
              ...record,
              state: parsed.data.status === "0x1" ? "confirmed" : "reverted",
              receipt,
              error: null,
            };
            break;
          }
        } catch (e) {
          if (e instanceof FrameShrinkError && !(e instanceof DevnetRpcError))
            throw e;
          record.error =
            "Receipt is not available yet; funding is not confirmed";
        }
        if (Date.now() >= deadline) break;
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(options.pollMs ?? 2000, deadline - Date.now()),
          ),
        );
      } while (Date.now() <= deadline);
      await writePrivateJSON(path.join(directory, "faucet.json"), record);
    }
    const after = await balance(wallet.address, reader);
    return {
      ...identity(wallet),
      requestedNow,
      faucet: record,
      balanceWei: after.toString(),
      balanceEth: formatEther(after),
      fundingConfirmed: record.state === "confirmed",
      note:
        record.state === "confirmed"
          ? "Faucet transfer included successfully; no stronger finality claim"
          : record.state === "unknown" || record.state === "requesting"
            ? "Unknown request outcome; no automatic repeat. Reconcile the faucet transfer before retrying."
            : record.state === "rejected"
              ? "Faucet refused the request. Respect its cooldown/rate limit."
              : "Faucet request is not confirmed; run wallet faucet again to check the same request.",
    };
  });
}
export function walletText(
  result: WalletIdentity & {
    created?: boolean;
    balanceEth?: string | null;
    networkChecked?: boolean;
    faucet?: FaucetRecord | null;
    fundingConfirmed?: boolean;
    note?: string;
  },
) {
  return [
    `Active test wallet: ${result.address}`,
    `Network: ${result.network} (chain ${result.chainId})`,
    ...(result.created !== undefined
      ? [
          result.created
            ? "Created a new local test wallet."
            : "Using the existing local test wallet.",
        ]
      : []),
    ...(result.balanceEth !== undefined
      ? [
          `Balance: ${result.balanceEth ?? "not checked"}${result.balanceEth !== null ? " devnet ETH" : ""}`,
        ]
      : []),
    ...(result.faucet
      ? [
          `Faucet: ${result.faucet.state}`,
          ...(result.faucet.txHash
            ? [`Faucet transaction: ${result.faucet.txHash}`]
            : []),
          ...(result.faucet.error
            ? [
                `Faucet detail: ${result.faucet.error.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")}`,
              ]
            : []),
        ]
      : []),
    ...(result.note ? [result.note] : []),
    "Local signing identity; this is not an explorer website login.",
    "Development key stored locally with private file permissions; never fund with real assets.",
  ].join("\n");
}

export async function withActiveWallet<T>(fn: () => Promise<T>) {
  return exclusiveWallet(activeWalletDirectory(), fn);
}
export async function signDemoSelfRelay(
  tx: import("../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js").FrameTransaction,
  directory = activeWalletDirectory(),
) {
  const { assertSelfRelay, computeSigHash } = await import("./self-relay.js");
  const wallet = await storedWallet(directory);
  assertSelfRelay(tx, wallet.address);
  const signature = await privateKeyToAccount(wallet.privateKey as Hex).sign({
    hash: computeSigHash(tx),
  });
  return {
    ...tx,
    signatures: [
      {
        ...tx.signatures[0],
        signature:
          `0x${(parseInt(signature.slice(-2), 16) - 27).toString(16).padStart(2, "0")}${signature.slice(2, -2)}` as Hex,
      },
    ],
  };
}

export async function signDemoDeployment(
  nonce: bigint,
  maxFeePerGas: bigint,
  directory = activeWalletDirectory(),
  version: import("./validator-code.js").ValidatorVersion = 1,
) {
  if (
    nonce < 0n ||
    nonce > BigInt(Number.MAX_SAFE_INTEGER) ||
    maxFeePerGas < 1000000000n ||
    maxFeePerGas > 100000000000n
  )
    throw new FrameShrinkError(
      "Deployment nonce or fee exceeds the demo limit",
      3,
    );
  const { validatorInit, VALIDATOR_FUNDING } = await import(
    "./validator-code.js"
  );
  const wallet = await storedWallet(directory);
  return privateKeyToAccount(wallet.privateKey as Hex).signTransaction({
    chainId: 1337,
    type: "eip1559",
    nonce: Number(nonce),
    gas: 500000n,
    maxFeePerGas,
    maxPriorityFeePerGas: 1000000000n,
    value: VALIDATOR_FUNDING,
    data: validatorInit(wallet.address, version),
  });
}

// Selection is scoped to the current async operation, never a mutable global.
import { AsyncLocalStorage } from "node:async_hooks";
const selectedWallet = new AsyncLocalStorage<string>();
export const activeWalletDirectory = () =>
  selectedWallet.getStore() ?? DEFAULT_DIRECTORY;
export const usingWallet = <T>(directory: string, fn: () => Promise<T>) =>
  selectedWallet.run(directory, fn);
export type NamedWallet = WalletIdentity & { name: string; directory: string };
export async function listWallets(
  base = DATA_DIRECTORY,
): Promise<NamedWallet[]> {
  const result: NamedWallet[] = [];
  const add = async (name: string, directory: string) => {
    try {
      await lstat(path.join(directory, "key.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    result.push({
      ...(await walletStatus({ directory, offline: true })),
      name,
      directory,
    });
  };
  await add("default", path.join(base, "wallet"));
  const directory = path.join(base, "wallets");
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw e;
  }
  await directorySafe(directory);
  for (const name of entries.sort()) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name))
      throw new FrameShrinkError("Invalid wallet directory name", 3);
    await add(name, path.join(directory, name));
  }
  return result;
}
export async function createNamedWallet(
  name: string,
  base = DATA_DIRECTORY,
): Promise<NamedWallet> {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || name === "default")
    throw new FrameShrinkError(
      "Use 1–32 lowercase letters, digits or hyphens; start with a letter",
      2,
    );
  const parent = path.join(base, "wallets");
  await directorySafe(parent);
  const directory = path.join(parent, name);
  // Existing named wallets are selected, never overwritten.
  return { ...(await createWallet(directory)), name, directory };
}
