/** Deliberate sponsor proof, separate from reduction. Chain-1337 testnet only; no real assets. */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ROOT, json, saveJSON } from "../src/shared.js";
import { computeSigHash } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import type { FrameTransaction } from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
const gateway = "https://altmempoolgateway.forshtat.com/rpc",
  execution = "https://altmempool.forshtat.com/rpc";
const allowed = new Set([
  "eth_chainId",
  "skandha_explorer_info",
  "skandha_explorer_faucet",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_sendFrameTransaction",
  "skandha_explorer_getTransaction",
  "skandha_frameTransactionStatus",
  "eth_getFrameTransactionReceipt",
  "eth_getTransactionReceipt",
]);
async function rpc(
  url: string,
  method: string,
  params: unknown[] = [],
): Promise<any> {
  if (!allowed.has(method) || ![gateway, execution].includes(url))
    throw Error("Public proof method/endpoint not allowed");
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw Error("HTTP " + r.status);
  const data = await r.json();
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result;
}
const delay = () => new Promise((r) => setTimeout(r, 2000));
await mkdir(ROOT + ".runs", { recursive: true });
await mkdir(ROOT + "evidence", { recursive: true });
const keyFile = ROOT + ".runs/public-proof.key";
let key: Hex;
try {
  key = (await readFile(keyFile, "utf8")).trim() as Hex;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  key = generatePrivateKey();
  await writeFile(keyFile, key, { mode: 0o600, flag: "wx" });
}
const account = privateKeyToAccount(key);
const evidenceFile = ROOT + "evidence/public-proof.json";
let evidence: any = {
  schemaVersion: 1,
  purpose: "separate corrected EOA self-relay on sponsor testnet",
  address: account.address,
  startedAt: new Date().toISOString(),
  gateway,
  execution,
  publicClientCommit: "not reported by gateway",
  candidateSubmissions: 0,
};
try {
  const prior = JSON.parse(await readFile(evidenceFile, "utf8"));
  if (prior.address === account.address) evidence = prior;
} catch {}
async function save() {
  await saveJSON(evidenceFile, evidence);
}
try {
  const chainId = await rpc(gateway, "eth_chainId");
  if (BigInt(chainId) !== 1337n)
    throw Error("Only sponsor test chain 1337 is supported");
  evidence.chainId = chainId;
  evidence.gatewayInfo = await rpc(gateway, "skandha_explorer_info");
  evidence.executionInfo = await rpc(execution, "skandha_explorer_info");
  let balance = BigInt(
    await rpc(gateway, "eth_getBalance", [account.address, "latest"]),
  );
  if (balance === 0n && !evidence.faucet) {
    if (!evidence.gatewayInfo.faucetEnabled)
      throw Error("Sponsor faucet unavailable");
    evidence.faucet = await rpc(gateway, "skandha_explorer_faucet", [
      account.address,
    ]);
    await save();
    console.log(
      "Requested sponsor test funds for fresh account " + account.address,
    );
  }
  for (let i = 0; balance === 0n && i < 30; i++) {
    await delay();
    balance = BigInt(
      await rpc(gateway, "eth_getBalance", [account.address, "latest"]),
    );
  }
  if (balance === 0n) throw Error("Faucet funding not confirmed");
  evidence.balanceBefore ??= "0x" + balance.toString(16);
  if (!evidence.txHash) {
    if (evidence.submissionAttempted)
      throw Error(
        "Previous submission outcome is unknown. Reconcile the stored signed payload before submitting again.",
      );
    const head = await rpc(gateway, "eth_getBlockByNumber", ["latest", false]);
    const base = BigInt(head.baseFeePerGas ?? "0x0"),
      priority = 1000000000n,
      maxFee = base * 2n + priority;
    if (maxFee > 100000000000n) throw Error("Test gas cap exceeded");
    const tx: FrameTransaction = {
      chainId: 1337n,
      nonceKeys: [0n],
      nonceSeq: BigInt(
        await rpc(gateway, "eth_getTransactionCount", [
          account.address,
          "latest",
        ]),
      ),
      sender: account.address,
      frames: [
        {
          mode: 1,
          flags: 3,
          target: null,
          limits: { execution: 30000n, state: 0n },
          value: 0n,
          data: "0x",
        },
        {
          mode: 2,
          flags: 0,
          target: account.address,
          limits: { execution: 50000n, state: 0n },
          value: 0n,
          data: "0x",
        },
      ],
      signatures: [{ scheme: 1, signer: "0x", msg: "0x", signature: "0x" }],
      fees: {
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
        maxFeePerBlobGas: 0n,
      },
      blobVersionedHashes: [],
      recentRootReferences: [],
    };
    const sig = await account.sign({ hash: computeSigHash(tx) });
    tx.signatures[0].signature = `0x${(parseInt(sig.slice(-2), 16) - 27).toString(16).padStart(2, "0")}${sig.slice(2, -2)}`;
    evidence.transaction = JSON.parse(json(tx));
    evidence.headBefore = { number: head.number, hash: head.hash };
    evidence.submissionAttempted = true;
    evidence.submittedAt = new Date().toISOString();
    await save();
    evidence.txHash = await rpc(gateway, "eth_sendFrameTransaction", [
      evidence.transaction,
    ]);
    evidence.candidateSubmissions = 1;
    evidence.admission = "send RPC accepted";
    await save();
    console.log(
      "Submitted one corrected public transaction: " + evidence.txHash,
    );
  }
  if (
    process.argv.includes("--relay-primary") &&
    !evidence.primaryRelayAttempted
  ) {
    evidence.primaryRelayAttempted = true;
    evidence.primaryRelayAt = new Date().toISOString();
    await save();
    const hash = await rpc(execution, "eth_sendFrameTransaction", [
      evidence.transaction,
    ]);
    if (hash !== evidence.txHash)
      throw Error(
        "Primary returned a different hash for the identical signed transaction",
      );
    evidence.primaryRelayHash = hash;
    await save();
    console.log(
      "Relayed the identical corrected transaction to the auto-bundling primary.",
    );
  }
  for (let i = 0; i < 20; i++) {
    try {
      evidence.admissionRecord = await rpc(
        gateway,
        "skandha_explorer_getTransaction",
        [evidence.txHash],
      );
    } catch (e) {
      evidence.admissionReadError = (e as Error).message;
    }
    try {
      evidence.status = await rpc(
        evidence.primaryRelayHash ? execution : gateway,
        "skandha_frameTransactionStatus",
        [evidence.txHash],
      );
    } catch (e) {
      evidence.statusReadError = (e as Error).message;
    }
    try {
      evidence.receipt = await rpc(
        execution,
        "eth_getFrameTransactionReceipt",
        [evidence.txHash],
      );
    } catch (e) {
      evidence.receiptReadError = (e as Error).message;
    }
    evidence.checkedAt = new Date().toISOString();
    await save();
    if (evidence.receipt) {
      console.log("Public receipt status: " + evidence.receipt.status);
      break;
    }
    await delay();
  }
  evidence.explorer =
    "https://explorer.altmempool.wtf/tx/" +
    evidence.txHash +
    "?node=" +
    encodeURIComponent(gateway);
  delete evidence.error;
  await save();
  console.log(
    json({
      address: account.address,
      txHash: evidence.txHash,
      status: evidence.status,
      receipt: evidence.receipt?.status,
      evidence: evidenceFile,
    }),
  );
} catch (e) {
  evidence.error = (e as Error).message;
  evidence.failedAt = new Date().toISOString();
  await save();
  console.error(evidence.error);
  process.exitCode = 1;
}
