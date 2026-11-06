import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRecipe, applyEdit, build, neighbors } from "../src/recipe.js";
import { hash, ROOT, FrameShrinkError } from "../src/shared.js";
import { reduce } from "../src/reducer.js";
import { inspectImported } from "../src/imported.js";
import { validateSignature } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/signature.js";
import { computeSigHash } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
const recipe = parseRecipe(
  JSON.parse(await readFile(ROOT + "fixtures/verify-gas.json", "utf8")),
);
test("strict schema rejects executable setup, endpoint overrides, duplicates and groups", () => {
  for (const x of [
    { ...recipe, command: "rm -rf /" },
    { ...recipe, endpoint: "https://public.example" },
    { ...recipe, body: [recipe.body[0], recipe.body[0]] },
    { ...recipe, body: [{ ...recipe.body[0], atomicGroup: "x" }] },
    { ...recipe, body: [] },
    { ...recipe, prefixGas: NaN },
  ])
    assert.throws(() => parseRecipe(x));
});
test("typed edits keep required prefix/body and stable IDs, never mutate the original", () => {
  const x = applyEdit(recipe, { kind: "remove-frames", ids: ["extra-a"] });
  assert.deepEqual(
    x.body.map((b) => b.id),
    ["required-call", "extra-b"],
  );
  assert.equal(recipe.body.length, 3);
  assert.throws(() =>
    applyEdit(recipe, { kind: "remove-frames", ids: ["required-call"] }),
  );
  assert.throws(() =>
    applyEdit(recipe, {
      kind: "remove-values",
      id: "extra-a",
      start: 2,
      count: 1,
    }),
  );
});
test("every mutation rebuilds ABI and produces a valid fresh canonical signature", async () => {
  const before = await build(recipe),
    after = await build(
      applyEdit(recipe, {
        kind: "remove-values",
        id: "required-call",
        start: 0,
        count: 1,
      }),
    );
  assert.notEqual(before.raw, after.raw);
  assert.notEqual(
    before.tx.signatures[0].signature,
    after.tx.signatures[0].signature,
  );
  assert.equal(
    await validateSignature(
      after.tx.signatures[0],
      after.tx.sender,
      computeSigHash(after.tx),
    ),
    true,
  );
  assert.equal(
    await validateSignature(
      before.tx.signatures[0],
      after.tx.sender,
      computeSigHash(after.tx),
    ),
    false,
  );
});
test("imported transactions remain diagnostic-only and require canonical bounded RLP", async () => {
  const { raw } = await build(recipe);
  const x = inspectImported({ schemaVersion: 1, mode: "imported", raw });
  assert.equal(x.permission, "read-only");
  assert.equal(x.frameCount, 4);
  assert.equal(x.diagnostics.structural.valid, false);
  for (const raw of ["0x06ff", "0x00", "0x06"])
    assert.throws(() =>
      inspectImported({ schemaVersion: 1, mode: "imported", raw }),
    );
  assert.throws(() =>
    inspectImported({
      schemaVersion: 1,
      mode: "imported",
      raw,
      command: "echo hi",
    }),
  );
});
test("fingerprint equality includes rule, state and profile", () => {
  assert.notEqual(
    hash({ rule: "OP-011", state: "a" }),
    hash({ rule: "OP-011", state: "b" }),
  );
  assert.notEqual(
    hash({ profile: "a", state: "a" }),
    hash({ profile: "b", state: "a" }),
  );
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
});
test("reducer refuses different or unstable failures and runtime errors", async () => {
  const profile = {} as any;
  const fake = async () =>
    ({
      status: "rejected",
      fingerprint: { rule: "a" },
      raw: "a",
      bytes: 100,
    }) as any;
  let i = 0;
  await assert.rejects(
    () =>
      reduce(recipe, profile, undefined, undefined, async () => {
        i++;
        return { ...(await fake()), fingerprint: { rule: i } };
      }),
    /Unstable baseline/,
  );
  await assert.rejects(
    () =>
      reduce(recipe, profile, undefined, undefined, async () => {
        throw new FrameShrinkError("missing trace");
      }),
    /missing trace/,
  );
});
