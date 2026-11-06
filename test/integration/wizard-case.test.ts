import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWallet, signDemoSelfRelay } from "../../src/wallet.js";
import { validatorRuntime } from "../../src/validator-code.js";
import {
  buildSignedCase,
  decodeSignedCase,
  expectedCause,
} from "../../src/demo.js";
import {
  makeCaseGenesis,
  startCaseRuntime,
  captureCaseProfile,
} from "../../src/case-runtime.js";
import { parseRecipe, type Recipe } from "../../src/recipe.js";
import { readJSON, ROOT } from "../../src/shared.js";
import { evaluateTx } from "../../src/runtime.js";
import { reduce, type EvaluationEvent } from "../../src/reducer.js";
import type { CaseContext } from "../../src/self-relay.js";

test("v2 combined fixture exposes TIMESTAMP then NUMBER then passes; signatures stay owner-bound", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-v2-"));
  try {
    const wd = path.join(root, "wallet"),
      wallet = await createWallet(wd),
      dir = path.join(root, "case");
    await mkdir(dir);
    const context: CaseContext = {
      schemaVersion: 1,
      chainId: 1337,
      address: wallet.address,
      nonce: "0x0",
      balance: "0xde0b6b3a7640000",
      code: "0x",
      maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0x3b9aca00",
      blockNumber: "0x100",
      blockHash: "0x" + "11".repeat(32),
      validator: {
        address: "0x00000000000000000000000000000000cafeb002",
        nonce: "0x1",
        balance: "0x2386f26fc10000",
        code: validatorRuntime(wallet.address, 2),
      },
    };
    await makeCaseGenesis(context, dir);
    await startCaseRuntime(dir);
    const profile = await captureCaseProfile(context, dir);
    const evaluator = async (recipe: Recipe) => {
      const record = await buildSignedCase(recipe, context, (tx) =>
        signDemoSelfRelay(tx, wd),
      );
      return evaluateTx(
        decodeSignedCase(record, context).tx,
        record.raw,
        record.frameIds,
        profile,
        true,
      );
    };
    let recipe = parseRecipe({
      ...(await readJSON(ROOT + "fixtures/banned-opcode.json")),
      opcodeMask: 3,
    });
    const stream: EvaluationEvent[] = [];
    const first = await reduce(
      recipe,
      profile,
      undefined,
      undefined,
      evaluator,
      (event) => stream.push(event),
    );
    assert.equal(
      first.baseline.fingerprint?.normalizedCause,
      "BANNED_OPCODE:TIMESTAMP",
    );
    assert(first.result.bytes < first.baseline.bytes);
    assert.equal(stream.length, first.evaluations);
    assert.deepEqual(
      stream.slice(0, 3).map((event) => event.phase),
      ["baseline", "repeat", "control"],
    );
    assert.equal(stream[1].sameFailure, true);
    assert.equal(stream[2].status, "accepted");
    assert(
      stream.some(
        (event) =>
          event.phase === "candidate" &&
          event.sameFailure &&
          event.bytes < first.baseline.bytes,
      ),
    );
    recipe = { ...first.reduced, opcodeMask: 2 };
    const second = await reduce(
      recipe,
      profile,
      undefined,
      undefined,
      evaluator,
    );
    assert.equal(
      second.baseline.fingerprint?.normalizedCause,
      "BANNED_OPCODE:NUMBER",
    );
    assert.equal(expectedCause(recipe), "BANNED_OPCODE:NUMBER");
    assert.equal(
      (await evaluator({ ...second.reduced, family: "verify-gas" })).status,
      "accepted",
    );
    const other = await createWallet(path.join(root, "other"));
    await assert.rejects(
      () =>
        buildSignedCase(recipe, context, (tx) =>
          signDemoSelfRelay(tx, path.join(root, "other")),
        ),
      /Only the fixed/,
    );
    assert.notEqual(other.address, wallet.address);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
