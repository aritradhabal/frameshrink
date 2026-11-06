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
  replayDemo,
  sealDemo,
  type SignedCase,
  type DebugStage,
} from "../../src/demo.js";
import {
  makeCaseGenesis,
  startCaseRuntime,
  captureCaseProfile,
} from "../../src/case-runtime.js";
import { parseRecipe, type Recipe } from "../../src/recipe.js";
import { readJSON, ROOT, saveJSON } from "../../src/shared.js";
import { evaluateTx, ownedExecutionFingerprint } from "../../src/runtime.js";
import { reduce } from "../../src/reducer.js";
import {
  firstFailure,
  correctFailure,
  recipeMask,
  FIXTURE_REVERT,
} from "../../src/failure-modes.js";
import type { CaseContext } from "../../src/self-relay.js";

test("v3 fixture: three new categories, all-five staged reduction, strict execution evidence and keyless replay", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-expanded-"));
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
        address: "0x00000000000000000000000000000000cafeb003",
        nonce: "0x1",
        balance: "0x2386f26fc10000",
        code: validatorRuntime(wallet.address, 3),
      },
    };
    await saveJSON(path.join(dir, "context.json"), context);
    await makeCaseGenesis(context, dir);
    await startCaseRuntime(dir);
    const profile = await captureCaseProfile(context, dir);
    await saveJSON(path.join(dir, "profile.json"), profile);
    const fixture = parseRecipe({
      ...(await readJSON(ROOT + "fixtures/banned-opcode.json")),
      family: "validation-fixture",
      failureMask: 31,
    });
    const sign = (recipe: Recipe) =>
      buildSignedCase(recipe, context, (tx) => signDemoSelfRelay(tx, wd));
    const evaluate = async (record: SignedCase) => {
      const mode = firstFailure(record.recipe);
      return evaluateTx(
        decodeSignedCase(record, context).tx,
        record.raw,
        record.frameIds,
        profile,
        true,
        mode?.id === "application-revert" || mode?.id === "static-write"
          ? mode.id
          : undefined,
      );
    };
    // Each new category also works independently, not only hidden inside a combined case.
    for (const failureMask of [16, 8, 4]) {
      const original = await sign({ ...fixture, failureMask });
      const verdict = await evaluate(original);
      assert.equal(
        verdict.fingerprint?.normalizedCause,
        expectedCause(original.recipe),
      );
      if (failureMask === 16) {
        assert.equal(verdict.simulation.revertData, FIXTURE_REVERT);
        const tx = decodeSignedCase(original, context).tx;
        for (const changed of [
          { failedFrameIndex: 1 },
          { haltReason: "out_of_gas" },
          { revertData: "0x" as const },
          { executionError: "RPC timeout" },
        ])
          await assert.rejects(
            () =>
              ownedExecutionFingerprint(
                tx,
                { ...verdict.simulation, ...changed },
                original.frameIds,
                profile,
                "application-revert",
              ),
            /does not prove/,
          );
      }
      if (failureMask === 8) {
        assert.equal(verdict.simulation.haltReason, "static_violation");
        await assert.rejects(
          () =>
            ownedExecutionFingerprint(
              decodeSignedCase(original, context).tx,
              { ...verdict.simulation, haltDetail: "unknown" },
              original.frameIds,
              profile,
              "static-write",
            ),
          /does not prove/,
        );
      }
      assert.equal(
        (
          await evaluate(
            await sign({ ...fixture, failureMask, family: "verify-gas" }),
          )
        ).status,
        "accepted",
      );
    }
    let current = await sign(fixture);
    const stages: DebugStage[] = [];
    await saveJSON(path.join(dir, "original.json"), current);
    while (recipeMask(current.recipe)) {
      const records = new Map<string, SignedCase>();
      const result = await reduce(
        current.recipe,
        profile,
        undefined,
        undefined,
        async (recipe) => {
          const record = await sign(recipe);
          records.set(JSON.stringify(recipe), record);
          return evaluate(record);
        },
      );
      const smaller = records.get(JSON.stringify(result.reduced))!;
      const correction = await sign(correctFailure(smaller.recipe));
      stages.push({
        failure: expectedCause(current.recipe),
        original: current,
        reduced: smaller,
        correction,
        fingerprint: result.baseline.fingerprint!,
        evaluations: result.evaluations,
      });
      if (stages.length === 1) {
        assert(result.result.bytes < result.baseline.bytes);
        await saveJSON(path.join(dir, "reduced.json"), smaller);
      }
      const after = await evaluate(correction);
      assert.equal(
        after.fingerprint?.normalizedCause ?? "accepted",
        recipeMask(correction.recipe)
          ? expectedCause(correction.recipe)
          : "accepted",
      );
      current = correction;
    }
    assert.deepEqual(
      stages.map((stage) => stage.failure),
      [
        "APPLICATION_REVERT:FrameShrinkFixtureFailure()",
        "STATIC_WRITE:VALIDATION_SSTORE",
        "BANNED_OPCODE:TIMESTAMP",
        "BANNED_OPCODE:NUMBER",
        "CODE_ACCESS:OWNER_NO_CODE",
      ],
    );
    await saveJSON(path.join(dir, "debug-stages.json"), stages);
    await saveJSON(path.join(dir, "corrected.json"), current);
    await saveJSON(path.join(dir, "run.json"), {
      schemaVersion: 1,
      kind: "frameshrink-devnet-case",
      state: "reduced",
      wallet: wallet.address,
      createdAt: new Date().toISOString(),
      directory: dir,
    });
    await sealDemo(dir);
    const actualFailure = stages[0].failure;
    stages[0].failure = "unverified display label";
    await saveJSON(path.join(dir, "debug-stages.json"), stages);
    await sealDemo(dir);
    await assert.rejects(
      () => replayDemo(dir),
      /Staged failure replay differs/,
    );
    stages[0].failure = actualFailure;
    await saveJSON(path.join(dir, "debug-stages.json"), stages);
    await sealDemo(dir);
    await rm(wd, { recursive: true, force: true });
    const replay = await replayDemo(dir);
    assert.equal(replay.exactSignedPayloads, true);
    assert.equal(replay.results.length, 8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
