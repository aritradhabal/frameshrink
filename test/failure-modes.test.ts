import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJSON, ROOT } from "../src/shared.js";
import { parseRecipe } from "../src/recipe.js";
import { casePlan, FAILURE_CHOICES } from "../src/wizard.js";
import {
  FAILURE_MODES,
  correctFailure,
  recipeMask,
  matchesPublicFailure,
  FIXTURE_REVERT,
} from "../src/failure-modes.js";
import { validatorRuntime } from "../src/validator-code.js";
import { unsignedSelfRelay } from "../src/self-relay.js";
import { createWallet } from "../src/wallet.js";

test("all selected failures survive the plan and corrections clear one defined branch at a time", async () => {
  const ids = FAILURE_MODES.map((mode) => mode.id);
  assert.deepEqual(casePlan(ids, "combined"), [31]);
  assert.deepEqual(casePlan(ids, "separate"), [16, 8, 1, 2, 4]);
  for (const id of ["application-revert", "static-write", "code-access"])
    assert(!FAILURE_CHOICES.find((choice) => choice.value === id)?.disabled);
  let recipe = parseRecipe({
    ...(await readJSON(ROOT + "fixtures/banned-opcode.json")),
    family: "validation-fixture",
    failureMask: 31,
  });
  const masks = [recipeMask(recipe)];
  for (let index = 0; index < 5; index++) {
    recipe = correctFailure(recipe);
    masks.push(recipeMask(recipe));
  }
  assert.deepEqual(masks, [31, 15, 7, 6, 4, 0]);
  assert.equal(recipe.family, "verify-gas");
});

test("new masks cannot silently run against legacy validator bytecode or mix incompatible fields", async () => {
  const base = await readJSON(ROOT + "fixtures/banned-opcode.json");
  for (const fields of [
    { family: "validation-fixture" },
    { family: "validation-fixture", failureMask: 32 },
    { family: "validation-fixture", failureMask: 0 },
    { family: "validation-fixture", failureMask: 16, opcodeMask: 1 },
    { family: "banned-opcode", failureMask: 16 },
  ])
    assert.throws(() => parseRecipe({ ...base, ...fields }));
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-versions-"));
  try {
    const wallet = await createWallet(path.join(root, "wallet"));
    const context = {
      schemaVersion: 1 as const,
      chainId: 1337 as const,
      address: wallet.address,
      nonce: "0x0",
      balance: "0xde0b6b3a7640000",
      code: "0x" as const,
      maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0x3b9aca00",
      blockNumber: "0x100",
      blockHash: "0x" + "11".repeat(32),
      validator: {
        address: "0x00000000000000000000000000000000cafeb003",
        nonce: "0x1",
        balance: "0x2386f26fc10000",
        code: validatorRuntime(wallet.address, 2),
      },
    };
    const recipe = parseRecipe({
      ...base,
      family: "validation-fixture",
      failureMask: 16,
    });
    assert.throws(() => unsignedSelfRelay(recipe, context), /v3 validator/);
    const tx = unsignedSelfRelay(recipe, {
      ...context,
      validator: {
        ...context.validator,
        code: validatorRuntime(wallet.address, 3),
      },
    });
    assert.equal(BigInt(tx.frames[0].data), 16n);
    assert.equal(
      BigInt(
        unsignedSelfRelay(correctFailure(recipe), {
          ...context,
          validator: {
            ...context.validator,
            code: validatorRuntime(wallet.address, 3),
          },
        }).frames[0].data,
      ),
      0n,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public evidence matching refuses generic reverts and unrelated code-access addresses", () => {
  const app = FAILURE_MODES.find((mode) => mode.id === "application-revert")!;
  const code = FAILURE_MODES.find((mode) => mode.id === "code-access")!;
  const owner = "0x" + "11".repeat(20),
    other = "0x" + "22".repeat(20);
  assert(!matchesPublicFailure(app, "validation frame 0: reverted", owner));
  assert(
    matchesPublicFailure(
      app,
      "validation frame 0: reverted with data " + FIXTURE_REVERT,
      owner,
    ),
  );
  assert(
    matchesPublicFailure(
      code,
      "payer accesses un-deployed contract address " +
        owner +
        " with opcode EXTCODESIZE",
      owner,
    ),
  );
  assert(
    !matchesPublicFailure(
      code,
      "payer accesses un-deployed contract address " +
        other +
        " with opcode EXTCODESIZE",
      owner,
    ),
  );
});
