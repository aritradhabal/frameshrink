import { FrameShrinkError } from "./shared.js";
export const DEVNET = {
  name: "Frame transaction sponsor devnet",
  chainId: 1337,
  rpc: "https://altmempoolgateway.forshtat.com/rpc",
  primary: "https://altmempool.forshtat.com/rpc",
} as const;
const READS = new Set([
  "eth_chainId",
  "skandha_explorer_info",
  "eth_getBalance",
  "eth_getTransactionReceipt",
]);
export class DevnetRpcError extends FrameShrinkError {
  constructor(
    message: string,
    public uncertain: boolean,
    public rpcCode?: number,
  ) {
    super(message, 4);
  }
}
async function call(
  method: string,
  params: unknown[],
  endpoint: string = DEVNET.rpc,
): Promise<unknown> {
  if (endpoint !== DEVNET.rpc && endpoint !== DEVNET.primary)
    throw new FrameShrinkError("Unsupported sponsor endpoint", 3);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    if (!response.body) throw Error("Empty response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          throw Error("RPC response exceeds 1 MiB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.jsonrpc !== "2.0" || data.id !== 1)
      throw Error("Malformed RPC envelope");
    if (data.error)
      throw new DevnetRpcError(
        String(data.error.message).slice(0, 1024),
        false,
        typeof data.error.code === "number" ? data.error.code : undefined,
      );
    if (!("result" in data)) throw Error("Missing RPC result");
    return data.result;
  } catch (e) {
    if (e instanceof DevnetRpcError) throw e;
    throw new DevnetRpcError(
      "Sponsor RPC unavailable; request outcome may be unknown",
      true,
    );
  }
}
export type DevnetReader = (
  method: string,
  params: unknown[],
) => Promise<unknown>;
export const readDevnet: DevnetReader = async (method, params) => {
  if (!READS.has(method))
    throw new FrameShrinkError("Wallet RPC method not allowed", 3);
  return call(method, params);
};
export async function requestSponsorFaucet(address: string): Promise<unknown> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new FrameShrinkError("Invalid faucet recipient", 2);
  return call("skandha_explorer_faucet", [address]);
}
export async function verifyDevnet(reader: DevnetReader = readDevnet) {
  const [chain, info] = await Promise.all([
    reader("eth_chainId", []),
    reader("skandha_explorer_info", []),
  ]);
  if (
    typeof chain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(chain) ||
    BigInt(chain) !== BigInt(DEVNET.chainId)
  )
    throw new FrameShrinkError(
      "Wallet operations require sponsor test chain 1337",
      3,
    );
  if (
    !info ||
    typeof info !== "object" ||
    (info as any).chainId !== DEVNET.chainId ||
    (info as any).protocolVersion !== 1
  )
    throw new FrameShrinkError("Unsupported sponsor node identity", 3);
  return info as {
    chainId: number;
    protocolVersion: number;
    faucetEnabled?: boolean;
    version?: string;
    bootId?: string;
  };
}

const DEMO_READS = new Set([
  ...READS,
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "skandha_explorer_getTransaction",
  "skandha_frameTransactionStatus",
  "eth_getFrameTransactionReceipt",
]);
export const readDemoDevnet: DevnetReader = async (method, params) => {
  if (!DEMO_READS.has(method))
    throw new FrameShrinkError("Demo read method not allowed", 3);
  return call(method, params, DEVNET.primary);
};
export async function submitDemoSelfRelay(
  tx: import("../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js").FrameTransaction,
) {
  const { assertSelfRelay } = await import("./self-relay.js");
  assertSelfRelay(tx);
  return call(
    "eth_sendFrameTransaction",
    [
      JSON.parse(
        JSON.stringify(tx, (_, v) =>
          typeof v === "bigint" ? "0x" + v.toString(16) : v,
        ),
      ),
    ],
    DEVNET.primary,
  );
}

export async function submitDemoDeployment(raw: `0x${string}`) {
  const { parseTransaction, recoverTransactionAddress } = await import("viem"),
    { validatorInit, VALIDATOR_FUNDING } = await import("./validator-code.js");
  if (!raw.startsWith("0x02"))
    throw new FrameShrinkError(
      "Only the fixed validator deployment is supported",
      3,
    );
  const tx = parseTransaction(raw);
  const owner = await recoverTransactionAddress({
    serializedTransaction: raw as `0x02${string}`,
  });
  if (
    tx.chainId !== 1337 ||
    tx.to ||
    tx.value !== VALIDATOR_FUNDING ||
    ![
      validatorInit(owner),
      validatorInit(owner, 2),
      validatorInit(owner, 3),
    ].includes(tx.data as `0x${string}`) ||
    !tx.gas ||
    tx.gas > 500000n ||
    !("maxFeePerGas" in tx) ||
    !tx.maxFeePerGas ||
    tx.maxFeePerGas > 100000000000n
  )
    throw new FrameShrinkError(
      "Only the fixed validator deployment is supported",
      3,
    );
  return call("eth_sendRawTransaction", [raw], DEVNET.primary);
}
