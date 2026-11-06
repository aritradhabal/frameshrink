import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { encodeAbiParameters } from "viem";
import { ROOT } from "../src/shared.js";
import {
  parseExplorerLink,
  decodeRevert,
  investigate,
  exportInvestigation,
  loadInvestigation,
  formatInvestigation,
  readRpc,
  type RpcRead,
  type Observation,
} from "../src/investigation.js";
const hash =
  "0xf5b65c96057977aaab766eb055520a001b22662c8dffef555068e7e56899ef09";
const link = `https://explorer.altmempool.wtf/tx/${hash}?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc`;
const source = parseExplorerLink(link);
const address = "0x" + "11".repeat(20);
const reason = "AnonAI: root from an old generation";
const revert =
  "0x08c379a0" + encodeAbiParameters([{ type: "string" }], [reason]).slice(2);
const detail = {
  hash,
  entry: null,
  admission: {
    txHash: hash,
    sender: address,
    outcome: "rejected",
    at: 1793971571570,
    checks: [
      {
        rule: "simulation",
        verdict: "fail",
        detail: "validation frame 0: reverted with data " + revert,
      },
    ],
    frames: Array.from({ length: 4 }, () => ({
      mode: 1,
      flags: 3,
      target: null,
      limits: { execution: "0x7530", state: "0x0" },
      value: "0x0",
      data: "0x",
    })),
  },
  events: [],
};
const ok = (result: unknown): Observation => ({ ok: true, result });
function mock(overrides: Record<string, Observation> = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: RpcRead = async (_, method, params) => {
    calls.push({ method, params });
    if (method in overrides) return overrides[method];
    if (method === "skandha_explorer_info")
      return ok({
        protocolVersion: 1,
        version: "v4.1.1",
        commit: "",
        bootId: "same",
      });
    if (method === "skandha_explorer_getTransaction")
      return ok(structuredClone(detail));
    if (method === "eth_chainId") return ok("0x539");
    if (method === "eth_getBlockByNumber")
      return ok({ number: "0x100", hash: "0x" + "22".repeat(32) });
    if (method === "eth_getTransactionByHash") return ok(null);
    if (method === "eth_getCode") return ok("0x6000");
    if (method === "eth_getBalance") return ok("0x1");
    if (method === "eth_getTransactionCount") return ok("0x0");
    throw Error("Unexpected method " + method);
  };
  return { rpc, calls };
}

test("explorer URLs cannot redirect capture to arbitrary RPC or private services", async () => {
  assert.equal(source.hash, hash);
  assert.equal(
    parseExplorerLink(link.replace("%2Frpc", "%2Frpc%2F")).endpoint,
    source.endpoint,
  );
  for (const bad of [
    link.replace("https://explorer", "http://explorer"),
    link.replace("/tx/0x", "/tx/bad0x"),
    link.replace("altmempoolgateway.forshtat.com", "127.0.0.1"),
    link.replace(
      "altmempoolgateway.forshtat.com",
      "altmempoolgateway.forshtat.com.attacker.example",
    ),
    link + "&node=https://altmempool.forshtat.com/rpc",
    link + "&command=echo",
    link.replace(
      "https%3A%2F%2Faltmempoolgateway",
      "https%3A%2F%2Fuser%3Asecret%40altmempoolgateway",
    ),
    link + "#fragment",
  ])
    assert.throws(() => parseExplorerLink(bad));
  await assert.rejects(
    () => readRpc(source.endpoint, "eth_sendFrameTransaction", []),
    /not allowed/,
  );
});
test("decodes standard revert data without guessing unknown custom errors", () => {
  assert.deepEqual(
    decodeRevert("validation frame 0: reverted with data " + revert),
    { type: "Error(string)", message: reason },
  );
  assert.equal(
    decodeRevert("reverted with data 0x12345678")?.type,
    "custom-error-selector",
  );
  for (const bad of [
    "reverted",
    "reverted with data 0x08c379a0",
    "reverted with data 0x123",
    "reverted with data 0x08c379a0…",
  ])
    assert.equal(decodeRevert(bad), null);
});
test("captured current data never becomes historical replay state, and no write methods run", async () => {
  const { rpc, calls } = mock();
  const report = await investigate(source, rpc);
  assert.equal(report.failures[0].decodedError?.message, reason);
  assert.equal(report.failures[0].frameIndex, 0);
  assert.equal(report.frameCount, 4);
  assert.equal(report.availability.signedTransaction, false);
  assert.equal(report.node.commit, null);
  assert.equal(report.currentState?.historicalRejectionState, false);
  assert.equal(report.reproducibility.status, "diagnostic-only");
  assert.equal(report.reproducibility.supportedOwnedAnalogue, null);
  assert(
    report.interpretation.inference?.includes("does not establish an EIP-8272"),
  );
  assert(
    calls.every(
      (c) => !c.method.includes("send") && !c.method.includes("simulate"),
    ),
  );
  assert(
    calls
      .filter((c) =>
        ["eth_getCode", "eth_getBalance", "eth_getTransactionCount"].includes(
          c.method,
        ),
      )
      .every((c) => c.params[1] === "0x100"),
  );
  const unsafe = structuredClone(report);
  unsafe.failures[0].decodedError!.message = "bad\x1b[31m";
  assert(!formatInvestigation(unsafe).includes("\x1b"));
});
test("missing history and changed boot identity cannot be reported as replayable", async () => {
  const absent = mock({
    skandha_explorer_getTransaction: {
      ok: false,
      error: { code: -32600, message: "Frame transaction not found" },
    },
  });
  assert.equal(
    (await investigate(source, absent.rpc)).status,
    "record-unavailable",
  );
  let i = 0;
  const normal = mock();
  const report = await investigate(source, async (u, m, p) =>
    m === "skandha_explorer_info"
      ? ok({ protocolVersion: 1, bootId: String(++i) })
      : normal.rpc(u, m, p),
  );
  assert.equal(report.node.stableDuringCapture, false);
  assert(
    report.reproducibility.missing.some((m) => m.includes("boot identity")),
  );
  const wrong = mock({
    skandha_explorer_getTransaction: ok({
      ...detail,
      hash: "0x" + "00".repeat(32),
    }),
  });
  await assert.rejects(
    () => investigate(source, wrong.rpc),
    /another transaction/,
  );
});
test("offline evidence verifies checksums, rejects tampering and cannot enter regression replay", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "frameshrink-case-"));
  const out = path.join(dir, "case");
  try {
    const report = await investigate(source, mock().rpc);
    await exportInvestigation(report, out);
    assert.equal(
      (await loadInvestigation(out)).failures[0].decodedError?.message,
      reason,
    );
    const replay = spawnSync(
      process.execPath,
      [ROOT + "bin/frameshrink.mjs", "replay", out],
      { encoding: "utf8" },
    );
    assert.equal(replay.status, 3);
    assert.match(replay.stderr, /diagnostic-only/i);
    await writeFile(path.join(out, "report.json"), "{}");
    await assert.rejects(() => loadInvestigation(out), /checksum mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
