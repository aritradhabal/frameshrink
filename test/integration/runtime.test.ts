import { manageRuntime } from "../../scripts/runtime.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, hash } from "../../src/shared.js";
import { parseRecipe, applyEdit, neighbors, build } from "../../src/recipe.js";
import { capture, evaluate, evaluateTx, rpc } from "../../src/runtime.js";
import { reduce } from "../../src/reducer.js";
import { exportBundle, replay, verifyBundle } from "../../src/bundle.js";
import { exclusive } from "../../src/lock.js";
test("real ethrex: two reductions, signatures, clean reconstruction, tamper checks and budgets", async () =>
  exclusive(async () => {
    const p = await capture();
    const saved = [];
    for (const family of ["verify-gas", "banned-opcode"]) {
      const r = parseRecipe(
        JSON.parse(await readFile(ROOT + `fixtures/${family}.json`, "utf8")),
      );
      const job = await reduce(r, p);
      saved.push(job);
      assert.equal(job.result.status, "rejected");
      assert.equal(job.control.status, "accepted");
      assert.equal(job.locallyMinimal, true);
      assert.equal(job.result.frameIds.length, 2);
      assert.equal(job.reduced.body[0].values.length, 0);
      assert(job.result.bytes < job.baseline.bytes);
      assert.equal(
        hash(job.result.fingerprint),
        hash(job.baseline.fingerprint),
      );
      assert.equal(neighbors(job.reduced).length, 0);
      assert(job.attempts.every((a) => a.accepted));
      const budget = await reduce(r, p, {
        maxEvaluations: 4,
        maxDurationMs: 120000,
      });
      assert.equal(budget.evaluations, 4);
      assert.equal(budget.termination, "evaluation-budget");
      assert.equal(budget.locallyMinimal, false);
      const wrongProfile = { ...p, headHash: "0x" + "00".repeat(32) };
      await assert.rejects(() => evaluate(r, wrongProfile), /State drift/);
      const built = await build(r);
      built.tx.signatures[0].signature = ("0x" +
        "00".repeat(65)) as `0x${string}`; // canonical raw must be rebuilt, rather than pairing altered metadata with old signed bytes
      const { encodeRawFrameTx } = await import(
        "../../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js"
      );
      await assert.rejects(() =>
        evaluateTx(built.tx, encodeRawFrameTx(built.tx), built.frameIds, p),
      );
      const other = await evaluate(
        {
          ...r,
          family: family === "verify-gas" ? "banned-opcode" : "verify-gas",
          prefixGas: family === "verify-gas" ? 30000 : 120000,
        },
        p,
      );
      assert.notEqual(hash(other.fingerprint), hash(job.baseline.fingerprint));
    }
    const dir = await mkdtemp(path.join(tmpdir(), "frameshrink-integration-"));
    const out = path.join(dir, "case");
    try {
      await exportBundle(saved[0], out);
      await verifyBundle(out);
      await manageRuntime("up");
      const replayed = await replay(out);
      assert.equal(replayed.status, "reproduced");
      await writeFile(path.join(out, "recipe.reduced.json"), "{}");
      await assert.rejects(() => verifyBundle(out), /Checksum mismatch/);
      await writeFile(path.join(out, "..evil"), "x");
      await assert.rejects(() => verifyBundle(out), /Unexpected bundle/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await assert.rejects(
      () => rpc("eth_sendFrameTransaction", []),
      /not allowed/,
    );
  }));
