import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { ROOT, saveJSON, hash } from "../../src/shared.js";
import { createWallet, signDemoSelfRelay } from "../../src/wallet.js";
import {
  buildSignedCase,
  decodeSignedCase,
  replayDemo,
  sealDemo,
  loadDemo,
} from "../../src/demo.js";
import {
  makeCaseGenesis,
  startCaseRuntime,
  captureCaseProfile,
} from "../../src/case-runtime.js";
import { evaluateTx } from "../../src/runtime.js";
import { reduce } from "../../src/reducer.js";
import { parseRecipe, type Recipe } from "../../src/recipe.js";
import type { CaseContext } from "../../src/self-relay.js";
import { validatorRuntime } from "../../src/validator-code.js";
for (const contract of [false, true])
  test(`captured ${contract ? "validator" : "EOA"}: exact payload reduction and signer-free replay`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "frameshrink-captured-")),
      directory = path.join(root, "case");
    await mkdir(directory);
    try {
      const walletDirectory = path.join(root, "wallet"),
        wallet = await createWallet(walletDirectory);
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
        ...(contract
          ? {
              validator: {
                address: "0x00000000000000000000000000000000cafeb001",
                code: validatorRuntime(wallet.address),
                nonce: "0x1",
                balance: "0x2386f26fc10000",
              },
            }
          : {}),
      };
      await saveJSON(path.join(directory, "context.json"), context);
      await makeCaseGenesis(context, directory);
      await startCaseRuntime(directory);
      const profile = await captureCaseProfile(context, directory);
      await saveJSON(path.join(directory, "profile.json"), profile);
      const recipe = parseRecipe(
        JSON.parse(
          await readFile(
            ROOT +
              (contract
                ? "fixtures/banned-opcode.json"
                : "fixtures/verify-gas.json"),
            "utf8",
          ),
        ),
      );
      const records = new Map();
      const evaluator = async (r: Recipe) => {
        const record = await buildSignedCase(r, context, (tx) =>
          signDemoSelfRelay(tx, walletDirectory),
        );
        records.set(hash(r), record);
        const { tx } = decodeSignedCase(record, context);
        return evaluateTx(tx, record.raw, record.frameIds, profile, true);
      };
      const job = await reduce(
        recipe,
        profile,
        undefined,
        undefined,
        evaluator,
      );
      assert.equal(
        job.baseline.fingerprint?.normalizedCause,
        contract
          ? "BANNED_OPCODE:TIMESTAMP"
          : "MAX_VERIFY_GAS:declared-prefix-plus-signatures",
      );
      assert(job.result.bytes < job.baseline.bytes);
      assert.equal(job.result.frameIds.length, 2);
      assert.equal(job.control.status, "accepted");
      for (const [name, r] of [
        ["original", recipe],
        ["reduced", job.reduced],
        [
          "corrected",
          { ...job.reduced, family: "verify-gas" as const, prefixGas: 30000 },
        ],
      ] as const) {
        const record =
          records.get(hash(r)) ??
          (await buildSignedCase(r, context, (tx) =>
            signDemoSelfRelay(tx, walletDirectory),
          ));
        await saveJSON(path.join(directory, name + ".json"), record);
      }
      await saveJSON(path.join(directory, "run.json"), {
        schemaVersion: 1,
        kind: "frameshrink-devnet-case",
        state: "reduced",
        wallet: wallet.address,
        createdAt: new Date().toISOString(),
        directory,
      });
      await sealDemo(directory);
      if (contract) {
        const {
            unsignedSelfRelay,
            encodeRawFrameTx,
            computeSigHash,
            caseFrameIds,
          } = await import("../../src/self-relay.js"),
          { privateKeyToAccount } = await import("viem/accounts"),
          { validateSignature } = await import(
            "../../.vendor/sidecar/packages/executor/lib/services/FrameTxService/signature.js"
          );
        const key = JSON.parse(
          await readFile(path.join(walletDirectory, "key.json"), "utf8"),
        ).privateKey;
        const wrong = unsignedSelfRelay(
          { ...job.reduced, family: "verify-gas", prefixGas: 30000 },
          context,
        );
        wrong.signatures[0].msg = ("0x" + "11".repeat(32)) as `0x${string}`;
        const signature = await privateKeyToAccount(key).sign({
          hash: wrong.signatures[0].msg,
        });
        wrong.signatures[0].signature = `0x${(parseInt(signature.slice(-2), 16) - 27).toString(16).padStart(2, "0")}${signature.slice(2, -2)}`;
        assert.equal(
          await validateSignature(
            wrong.signatures[0],
            wrong.sender,
            computeSigHash(wrong),
          ),
          true,
        );
        await assert.rejects(
          () =>
            evaluateTx(
              wrong,
              encodeRawFrameTx(wrong),
              caseFrameIds(job.reduced, context),
              profile,
              true,
            ),
          /trace\/execution evidence/,
        );
      }
      await rm(walletDirectory, { recursive: true, force: true });
      const replayed = await replayDemo(directory);
      assert.equal(replayed.exactSignedPayloads, true);
      assert.deepEqual(
        replayed.results.map((r) => r.status),
        ["rejected", "rejected", "accepted"],
      );
      await writeFile(path.join(directory, "corrected.json"), "{}");
      await assert.rejects(() => loadDemo(directory), /checksum mismatch/);
    } finally {
      try {
        execFileSync("docker", ["rm", "-f", "frameshrink-case-ethrex"], {
          stdio: "pipe",
        });
      } catch {}
      await rm(root, { recursive: true, force: true });
    }
  });
