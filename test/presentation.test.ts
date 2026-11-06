import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceLabel,
  transactionResult,
  fitChoiceLabel,
  reductionMetrics,
} from "../src/presentation.js";
import { prepareRuntime } from "../src/environment.js";
import type { DemoRun } from "../src/demo.js";
import { IMAGE } from "../src/shared.js";

test("balance and reduction summaries keep useful precision without long decimal noise", () => {
  assert.equal(balanceLabel("0.989636155997453092"), "0.989636 ETH");
  assert.equal(balanceLabel("1.000000"), "1 ETH");
  assert.equal(balanceLabel("0.000000001"), "<0.000001 ETH");
  assert.equal(balanceLabel(null), "Balance unavailable");
  assert.match(
    reductionMetrics(
      {
        originalFrames: 4,
        reducedFrames: 2,
        originalBytes: 767,
        reducedBytes: 282,
      },
      false,
    ),
    /63.2% smaller/,
  );
  const name = fitChoiceLabel(
    "A long planned category that would wrap beyond the terminal",
    "— planned for a future release",
    72,
  );
  assert(name.endsWith("…"));
  assert(name.length + 5 + "— planned for a future release".length <= 72);
});

test("uncertain public outcomes cannot be labelled pending or accepted", () => {
  const base = { correctedHash: "0x" + "ab".repeat(32) } as DemoRun;
  assert.match(
    transactionResult({ ...base, state: "complete" }, false),
    /CONFIRMED/,
  );
  assert.match(
    transactionResult({ ...base, state: "pending" }, false),
    /PENDING/,
  );
  const cancelled = transactionResult(
    {
      ...base,
      state: "inconclusive",
      error: "Public relayer cancelled submission",
    },
    false,
  );
  assert.match(cancelled, /UNCONFIRMED/);
  assert(!cancelled.includes("PENDING"));
});

test("Docker preflight stops before image operations when Docker is absent or stopped", async () => {
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const calls: string[][] = [];
    await assert.rejects(
      () =>
        prepareRuntime({
          run: async (args) => {
            calls.push(args);
            throw Object.assign(new Error("internal details"), { code });
          },
        }),
      (error) => {
        assert.match((error as Error).message, /Docker/);
        assert(!(error as Error).message.includes("internal details"));
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "info");
  }
});

test("first-run preflight downloads only the pinned image and reports a failed download", async () => {
  const calls: string[][] = [],
    messages: string[] = [];
  await prepareRuntime({
    onProgress: (message) => messages.push(message),
    run: async (args) => {
      calls.push(args);
      if (args[0] === "image") throw Error("missing image");
    },
  });
  assert.deepEqual(calls.at(-1), ["pull", IMAGE]);
  assert(messages.some((message) => message.includes("first run")));
  await assert.rejects(
    () =>
      prepareRuntime({
        run: async (args) => {
          if (args[0] !== "info") throw Error("network failure");
        },
      }),
    /Could not download/,
  );
});
