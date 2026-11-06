import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { ROOT, hash } from "../src/shared.js";
import {
  createWallet,
  signDemoSelfRelay,
  signDemoDeployment,
} from "../src/wallet.js";
import {
  unsignedSelfRelay,
  assertSelfRelay,
  computeSigHash,
  type CaseContext,
} from "../src/self-relay.js";
import {
  buildSignedCase,
  decodeSignedCase,
  captureDemoContext,
} from "../src/demo.js";
import { validateSignature } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/signature.js";
import { terminal } from "../src/terminal.js";
import { spawnSync } from "node:child_process";
const recipe = JSON.parse(
  await readFile(ROOT + "fixtures/verify-gas.json", "utf8"),
);
export const testContext = (address: string): CaseContext => ({
  schemaVersion: 1,
  chainId: 1337,
  address,
  nonce: "0x0",
  balance: "0xde0b6b3a7640000",
  code: "0x",
  maxFeePerGas: "0x77359400",
  maxPriorityFeePerGas: "0x3b9aca00",
  blockNumber: "0x100",
  blockHash: "0x" + "11".repeat(32),
});
test("funded-key signer only accepts fixed zero-value self-relays on the sponsor chain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-sign-"));
  try {
    const wallet = await createWallet(path.join(root, "wallet")),
      context = testContext(wallet.address);
    const valid = unsignedSelfRelay(recipe, context);
    const signed = await signDemoSelfRelay(valid, path.join(root, "wallet"));
    assert.equal(
      await validateSignature(
        signed.signatures[0],
        signed.sender,
        computeSigHash(signed),
      ),
      true,
    );
    for (const change of [
      (tx: any) => (tx.chainId = 1n),
      (tx: any) => (tx.frames[1].value = 1n),
      (tx: any) => (tx.frames[1].target = "0x" + "99".repeat(20)),
      (tx: any) => (tx.frames[0].limits.execution = 200000n),
      (tx: any) => (tx.fees.maxFeePerGas = 100000000001n),
      (tx: any) => (tx.frames[1].data = "0xdeadbeef"),
    ]) {
      const bad = structuredClone(valid);
      change(bad);
      await assert.rejects(
        () => signDemoSelfRelay(bad, path.join(root, "wallet")),
        /fixed chain-1337/,
      );
    }
    const record = await buildSignedCase(recipe, context, (tx) =>
      signDemoSelfRelay(tx, path.join(root, "wallet")),
    );
    assert.equal(decodeSignedCase(record, context).record.raw, record.raw);
    const edited = structuredClone(record);
    edited.recipe.body.pop();
    assert.throws(() => decodeSignedCase(edited, context), /differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("capture rejects changed source blocks and wrong-chain nodes before any submission", async () => {
  const address = "0x" + "11".repeat(20);
  const reader = async (method: string, params: unknown[]) => {
    if (method === "eth_chainId") return "0x539";
    if (method === "skandha_explorer_info")
      return { chainId: 1337, protocolVersion: 1 };
    if (method === "eth_getBlockByNumber")
      return {
        number: "0x100",
        hash: "0x" + (params[0] === "latest" ? "11" : "22").repeat(32),
        baseFeePerGas: "0x7",
      };
    if (method === "eth_getCode") return "0x";
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_getTransactionCount") return "0x0";
    throw Error("Unexpected method");
  };
  await assert.rejects(
    () => captureDemoContext(address, reader),
    /block changed/,
  );
});
test("terminal colors are controlled and CLI summaries stay concise while JSON stays clean", () => {
  assert.match(terminal(true).badge("ACCEPTED", "green"), /\x1b\[42;30;1m/);
  assert.equal(terminal(false).badge("ACCEPTED", "green"), "[ACCEPTED]");
  assert(!terminal(false).badge("bad\x1b[31m", "red").includes("\x1b"));
  assert.match(terminal(true).ok("ready"), /\x1b\[32m/);
  assert(!terminal(false).ok("ready").includes("\x1b"));
  assert(!terminal(false).error("bad\x1b[31m").includes("\x1b"));
  const options = {
    cwd: ROOT,
    encoding: "utf8" as const,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      FORCE_COLOR: "1",
      NO_COLOR: undefined,
    },
  };
  const colored = spawnSync(
    process.execPath,
    [ROOT + "bin/frameshrink.mjs", "failures"],
    options,
  );
  assert.equal(colored.status, 0);
  assert(colored.stdout.includes("\x1b["));
  assert.equal((colored.stdout.match(/\[reducible\]/g) ?? []).length, 5);
  const noColor = spawnSync(
    process.execPath,
    [ROOT + "bin/frameshrink.mjs", "failures", "--no-color"],
    options,
  );
  assert(!noColor.stdout.includes("\x1b["));
  assert.equal(noColor.stdout.trim().split("\n").length, 20);
  const machine = spawnSync(
    process.execPath,
    [ROOT + "bin/frameshrink.mjs", "failures", "--json"],
    options,
  );
  assert.equal(JSON.parse(machine.stdout).schemaVersion, 1);
  assert(!machine.stdout.includes("\x1b["));
});

test("deployment signer fixes the owner, funding and chain, and rejects unsafe bounds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-deploy-"));
  try {
    const directory = path.join(root, "wallet"),
      wallet = await createWallet(directory);
    const { parseTransaction, recoverTransactionAddress } = await import(
        "viem"
      ),
      { validatorInit, VALIDATOR_FUNDING } = await import(
        "../src/validator-code.js"
      );
    const raw = await signDemoDeployment(0n, 2000000000n, directory),
      tx = parseTransaction(raw);
    assert.equal(tx.chainId, 1337);
    assert.equal(tx.value, VALIDATOR_FUNDING);
    assert.equal(tx.data, validatorInit(wallet.address));
    assert.equal(
      await recoverTransactionAddress({
        serializedTransaction: raw as `0x02${string}`,
      }),
      wallet.address,
    );
    await assert.rejects(() => signDemoDeployment(-1n, 2000000000n, directory));
    await assert.rejects(() =>
      signDemoDeployment(0n, 100000000001n, directory),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
