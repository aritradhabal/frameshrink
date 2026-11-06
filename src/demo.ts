import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { FrameTransaction } from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
import { decodeFrameTx } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import {
  DEVNET,
  DevnetRpcError,
  readDemoDevnet,
  submitDemoSelfRelay,
  verifyDevnet,
  type DevnetReader,
} from "./devnet.js";
import { walletStatus, signDemoSelfRelay, withActiveWallet } from "./wallet.js";
import {
  ROOT,
  DATA_DIRECTORY,
  json,
  saveJSON,
  readJSON,
  bytesHash,
  hash,
  FrameShrinkError,
} from "./shared.js";
import {
  firstFailure,
  recipeMask,
  correctFailure,
  matchesPublicFailure,
  FAILURE_MODES,
  MAX_FAILURE_MASK,
  failureLabel,
} from "./failure-modes.js";
import { parseRecipe, type Recipe } from "./recipe.js";
import {
  ContextSchema,
  unsignedSelfRelay,
  assertSelfRelay,
  encodeRawFrameTx,
  transactionHash,
  caseFrameIds,
  type CaseContext,
} from "./self-relay.js";
import {
  makeCaseGenesis,
  startCaseRuntime,
  captureCaseProfile,
} from "./case-runtime.js";
import { evaluateTx, type Profile, type Evaluation } from "./runtime.js";
import { reduce, type Budget, type EvaluationEvent } from "./reducer.js";
import { exclusive } from "./lock.js";
const FILES = new Set([
  "context.json",
  "genesis.json",
  "run.json",
  "original.json",
  "reduced.json",
  "corrected.json",
  "reduction.json",
  "profile.json",
  "public-rejection.json",
  "public-correction.json",
  "local-replay.json",
  "README.txt",
  "validator-deployment.json",
  "debug-stages.json",
]);
const CAUSE = "MAX_VERIFY_GAS:declared-prefix-plus-signatures";
export const expectedCause = (recipe: Recipe) =>
  firstFailure(recipe)?.cause ?? CAUSE;
export type DebugStage = {
  failure: string;
  original: SignedCase;
  reduced: SignedCase;
  correction: SignedCase;
  evaluations: number;
  fingerprint: NonNullable<Evaluation["fingerprint"]>;
};
import { ensureDemoValidator } from "./validator.js";
export type DemoRun = {
  schemaVersion: 1;
  kind: "frameshrink-devnet-case";
  state:
    | "preparing"
    | "rejected"
    | "reduced"
    | "pending"
    | "complete"
    | "inconclusive";
  wallet: string;
  createdAt: string;
  originalHash?: string;
  correctedHash?: string;
  originalAttemptedAt?: string;
  correctedAttemptedAt?: string;
  originalFrames?: number;
  reducedFrames?: number;
  originalBytes?: number;
  reducedBytes?: number;
  replay?: string;
  blockNumber?: string;
  explorer?: string;
  error?: string;
  directory: string;
};
export async function captureDemoContext(
  address: string,
  reader: DevnetReader = readDemoDevnet,
  validatorAddress?: string,
): Promise<CaseContext> {
  await verifyDevnet(reader);
  const head: any = await reader("eth_getBlockByNumber", ["latest", false]);
  if (
    !head ||
    typeof head.number !== "string" ||
    !/^0x[0-9a-f]+$/i.test(head.number) ||
    !/^0x[0-9a-f]{64}$/i.test(head.hash)
  )
    throw new FrameShrinkError("Public head is unavailable", 4);
  const [balance, nonce, code, checked] = await Promise.all([
    reader("eth_getBalance", [address, head.number]),
    reader("eth_getTransactionCount", [address, head.number]),
    reader("eth_getCode", [address, head.number]),
    reader("eth_getBlockByNumber", [head.number, false]),
  ]);
  if ((checked as any)?.hash !== head.hash)
    throw new FrameShrinkError("Public block changed during capture", 4);
  const base = BigInt(head.baseFeePerGas ?? "0x0"),
    priority = 1000000000n,
    max = base * 2n + priority;
  let validator: unknown;
  if (validatorAddress) {
    const [code, balance, nonce] = await Promise.all([
      reader("eth_getCode", [validatorAddress, head.number]),
      reader("eth_getBalance", [validatorAddress, head.number]),
      reader("eth_getTransactionCount", [validatorAddress, head.number]),
    ]);
    validator = { address: validatorAddress, code, balance, nonce };
  }
  const parsed = ContextSchema.safeParse({
    schemaVersion: 1,
    chainId: 1337,
    address,
    nonce,
    balance,
    code,
    maxFeePerGas: "0x" + max.toString(16),
    maxPriorityFeePerGas: "0x" + priority.toString(16),
    blockNumber: head.number,
    blockHash: head.hash,
    ...(validator ? { validator } : {}),
  });
  if (!parsed.success || max > 100000000000n)
    throw new FrameShrinkError(
      "Demo requires an undelegated EOA on chain 1337 and bounded fees",
      3,
    );
  if (BigInt(parsed.data.balance) < 420000n * max)
    throw new FrameShrinkError(
      "Insufficient demo funds; run frameshrink wallet faucet",
      3,
    );
  return parsed.data;
}
export type SignedCase = {
  recipe: Recipe;
  raw: `0x${string}`;
  hash: `0x${string}`;
  frameIds: string[];
};
export async function buildSignedCase(
  recipe: Recipe,
  context: CaseContext,
  signer = signDemoSelfRelay,
): Promise<SignedCase> {
  const tx = await signer(unsignedSelfRelay(recipe, context));
  assertSelfRelay(tx, context.address);
  return {
    recipe,
    raw: encodeRawFrameTx(tx),
    hash: transactionHash(tx),
    frameIds: caseFrameIds(recipe, context),
  };
}
export function decodeSignedCase(
  value: unknown,
  context: CaseContext,
): { record: SignedCase; tx: FrameTransaction } {
  const v = value as SignedCase;
  if (
    !v ||
    typeof v.raw !== "string" ||
    !/^0x06(?:[0-9a-f]{2})+$/i.test(v.raw) ||
    v.raw.length > 32768 ||
    !Array.isArray(v.frameIds)
  )
    throw new FrameShrinkError("Invalid signed case", 2);
  const recipe = parseRecipe(v.recipe),
    tx = decodeFrameTx(Buffer.from(v.raw.slice(4), "hex"));
  assertSelfRelay(tx, context.address);
  const expected = unsignedSelfRelay(recipe, context);
  expected.signatures = tx.signatures;
  if (
    encodeRawFrameTx(tx) !== v.raw ||
    encodeRawFrameTx(expected) !== v.raw ||
    transactionHash(tx) !== v.hash ||
    hash(v.frameIds) !== hash(caseFrameIds(recipe, context))
  )
    throw new FrameShrinkError(
      "Signed payload differs from its captured recipe",
      5,
    );
  return { record: v, tx };
}
async function evaluateSigned(
  record: SignedCase,
  context: CaseContext,
  profile: Profile,
): Promise<Evaluation> {
  const { tx } = decodeSignedCase(record, context);
  const mode = firstFailure(record.recipe);
  const execution =
    mode?.id === "application-revert" || mode?.id === "static-write"
      ? mode.id
      : undefined;
  return evaluateTx(tx, record.raw, record.frameIds, profile, true, execution);
}
async function checkpoint(directory: string, run: DemoRun) {
  const file = path.join(directory, "run.json"),
    temp = file + ".tmp";
  await writeFile(temp, json(run) + "\n");
  await rename(temp, file);
}
export async function sealDemo(directory: string) {
  const checksums: Record<string, string> = {};
  for (const file of await readdir(directory)) {
    if (file === "manifest.json") continue;
    if (!FILES.has(file))
      throw new FrameShrinkError("Unexpected demo artifact", 2);
    checksums[file] = bytesHash(await readFile(path.join(directory, file)));
  }
  await saveJSON(path.join(directory, "manifest.json"), {
    schemaVersion: 1,
    kind: "frameshrink-devnet-case",
    checksums,
  });
}
export async function loadDemo(directory: string): Promise<DemoRun> {
  const names = await readdir(directory);
  for (const name of names) {
    if (name !== "manifest.json" && !FILES.has(name))
      throw new FrameShrinkError("Unexpected demo file", 2);
    const stat = await lstat(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152)
      throw new FrameShrinkError("Invalid demo artifact", 2);
  }
  const manifest = await readJSON(path.join(directory, "manifest.json"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "frameshrink-devnet-case" ||
    Object.keys(manifest.checksums ?? {})
      .sort()
      .join() !==
      names
        .filter((n) => n !== "manifest.json")
        .sort()
        .join()
  )
    throw new FrameShrinkError("Invalid demo manifest", 2);
  for (const file of Object.keys(manifest.checksums))
    if (
      bytesHash(await readFile(path.join(directory, file))) !==
      manifest.checksums[file]
    )
      throw new FrameShrinkError("Demo checksum mismatch: " + file, 5);
  const run = await readJSON(path.join(directory, "run.json"));
  if (
    run.kind !== "frameshrink-devnet-case" ||
    run.schemaVersion !== 1 ||
    !/^0x[0-9a-f]{40}$/i.test(run.wallet) ||
    ![
      "preparing",
      "rejected",
      "reduced",
      "pending",
      "complete",
      "inconclusive",
    ].includes(run.state)
  )
    throw new FrameShrinkError("Invalid demo record", 2);
  return { ...run, directory: path.resolve(directory) };
}
async function replayOpen(directory: string) {
  const context = ContextSchema.parse(
    await readJSON(path.join(directory, "context.json")),
  );
  await startCaseRuntime(directory);
  const profile = await captureCaseProfile(context, directory);
  const saved = await readJSON(path.join(directory, "profile.json"));
  if (
    profile.profileHash !== saved.profileHash ||
    profile.stateHash !== saved.stateHash
  )
    throw new FrameShrinkError("Case replay profile changed", 3);
  let fp: string | null = null;
  const results = [];
  for (const name of ["original", "reduced", "corrected"]) {
    const item = await readJSON(path.join(directory, name + ".json"));
    const result = await evaluateSigned(item, context, profile);
    if (name === "corrected") {
      if (result.status !== "accepted")
        throw new FrameShrinkError("Corrected local control failed", 5);
    } else {
      const cause = expectedCause(item.recipe);
      if (result.fingerprint?.normalizedCause !== cause)
        throw new FrameShrinkError("Local rejection predicate changed", 5);
      if (fp && fp !== hash(result.fingerprint))
        throw new FrameShrinkError("Reduced fingerprint differs", 5);
      fp = hash(result.fingerprint);
    }
    results.push({
      name,
      status: result.status,
      bytes: result.bytes,
      message: result.message,
    });
  }
  // Each staged correction must expose the next selected failure, ending in acceptance.
  let stages: DebugStage[] = [];
  try {
    stages = await readJSON(path.join(directory, "debug-stages.json"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const [index, stage] of stages.entries()) {
    const baseline = await evaluateSigned(stage.original, context, profile);
    const smaller = await evaluateSigned(stage.reduced, context, profile);
    const after = await evaluateSigned(stage.correction, context, profile);
    if (
      hash(baseline.fingerprint) !== hash(stage.fingerprint) ||
      hash(smaller.fingerprint) !== hash(stage.fingerprint) ||
      baseline.fingerprint?.normalizedCause !==
        expectedCause(stage.original.recipe) ||
      (index + 1 === stages.length
        ? after.status !== "accepted"
        : after.fingerprint?.normalizedCause !==
          expectedCause(stages[index + 1].original.recipe)) ||
      (index + 1 < stages.length &&
        stage.correction.raw !== stages[index + 1].original.raw)
    )
      throw new FrameShrinkError("Staged failure replay differs", 5);
    results.push({
      name: "stage-" + (index + 1),
      status: smaller.status,
      bytes: smaller.bytes,
      message: smaller.message,
    });
  }
  return {
    schemaVersion: 1,
    status: "reproduced",
    exactSignedPayloads: true,
    profileHash: profile.profileHash,
    stateHash: profile.stateHash,
    results,
  };
}
export async function replayDemo(directory: string) {
  return exclusive(async () => {
    await loadDemo(directory);
    return replayOpen(directory);
  });
}
async function publicDetail(hash: string) {
  const response: any = await readDemoDevnet(
    "skandha_explorer_getTransaction",
    [hash],
  );
  if (
    response?.hash?.toLowerCase() !== hash.toLowerCase() ||
    response?.admission?.txHash?.toLowerCase() !== hash.toLowerCase()
  )
    throw new FrameShrinkError(
      "Public admission record does not match the transaction",
      4,
    );
  return response;
}
async function finishPublic(directory: string, run: DemoRun, waitMs = 30000) {
  if (!run.correctedHash)
    throw new FrameShrinkError("No corrected submission to reconcile", 3);
  const end = Date.now() + waitMs;
  let receipt: any = null,
    lastError = "";
  do {
    try {
      receipt = await readDemoDevnet("eth_getFrameTransactionReceipt", [
        run.correctedHash,
      ]);
      if (receipt) break;
    } catch (e) {
      lastError = (e as Error).message;
    }
    if (Date.now() >= end) break;
    await new Promise((r) => setTimeout(r, Math.min(2000, end - Date.now())));
  } while (Date.now() <= end);
  if (!receipt) {
    const lifecycle: any = await readDemoDevnet(
      "skandha_frameTransactionStatus",
      [run.correctedHash],
    ).catch(() => null);
    if (lifecycle?.status === "Cancelled") {
      run.state = "inconclusive";
      run.error =
        "Public relayer cancelled submission · " +
        String(lifecycle.reason ?? "no reason reported").slice(0, 512);
      await saveJSON(path.join(directory, "public-correction.json"), {
        lifecycle,
        receipt: null,
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    run.state = "pending";
    run.error = "Receipt pending; use demo resume. " + lastError;
    return;
  }
  if (
    receipt.status !== "success" ||
    !Array.isArray(receipt.frameReceipts) ||
    receipt.frameReceipts.length !== run.reducedFrames ||
    receipt.frameReceipts.some((f: any) => f.status !== "success") ||
    !/^0x[0-9a-f]+$/i.test(receipt.blockNumber)
  )
    throw new FrameShrinkError("Corrected public execution did not succeed", 5);
  const admission = await publicDetail(run.correctedHash);
  if (!["accepted", "included"].includes(admission.admission.outcome))
    throw new FrameShrinkError(
      "Corrected public admission was not accepted",
      5,
    );
  await saveJSON(path.join(directory, "public-correction.json"), {
    admission,
    receipt,
    checkedAt: new Date().toISOString(),
  });
  run.state = "complete";
  run.blockNumber = receipt.blockNumber;
  run.explorer = `https://explorer.altmempool.wtf/tx/${run.correctedHash}?node=${encodeURIComponent(DEVNET.primary)}`;
  delete run.error;
}
export async function resumeDemo(directory: string) {
  return withActiveWallet(async () => {
    const run = await loadDemo(directory);
    if (
      !run.correctedHash ||
      !["pending", "complete", "inconclusive"].includes(run.state)
    )
      throw new FrameShrinkError(
        "No known corrected submission to reconcile; no transaction was resent",
        3,
      );
    try {
      await verifyDevnet(readDemoDevnet);
      await finishPublic(directory, run);
      await checkpoint(directory, run);
    } finally {
      await sealDemo(directory);
    }
    return run;
  });
}
export type DemoOptions = {
  onOriginalRejected?: (run: DemoRun) => void;
  onEvaluation?: (
    stage: number,
    failure: string,
    event: EvaluationEvent,
  ) => void;
  opcodeMask?: 1 | 2 | 3;
  failureMask?: number;
  beforeDeploy?: () => Promise<boolean>;
  beforeOriginal?: (
    original: SignedCase,
    context: CaseContext,
  ) => Promise<boolean>;
  beforeDebug?: (run: DemoRun) => Promise<Budget | false>;
  beforeCorrected?: (
    run: DemoRun,
    corrected: SignedCase,
    stages: DebugStage[],
    context: CaseContext,
  ) => Promise<boolean>;
  resume?: boolean;
};
export async function runDemo(
  directory: string,
  onProgress: (message: string) => void = () => {},
  options: DemoOptions = {},
): Promise<DemoRun> {
  if (
    options.failureMask !== undefined &&
    (!Number.isInteger(options.failureMask) ||
      options.failureMask < 1 ||
      options.failureMask > MAX_FAILURE_MASK ||
      options.opcodeMask !== undefined)
  )
    throw new FrameShrinkError("Invalid controlled failure selection", 2);
  if (!options.resume) {
    try {
      await lstat(directory);
      throw new FrameShrinkError(
        "Case directory already exists; choose a new --out directory",
        2,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return withActiveWallet(async () =>
    exclusive(async () => {
      const wallet = await walletStatus({ offline: true });
      let run: DemoRun;
      let context: CaseContext;
      let original: SignedCase;
      if (options.resume) {
        run = await loadDemo(directory);
        if (
          run.wallet !== wallet.address ||
          !["rejected", "reduced"].includes(run.state) ||
          run.correctedAttemptedAt
        )
          throw new FrameShrinkError(
            "Case cannot continue with this wallet/state; no transaction was resent",
            3,
          );
        context = ContextSchema.parse(
          await readJSON(path.join(directory, "context.json")),
        );
        original = decodeSignedCase(
          await readJSON(path.join(directory, "original.json")),
          context,
        ).record;
      } else {
        const deployment = await ensureDemoValidator({
          version: options.failureMask ? 3 : options.opcodeMask ? 2 : 1,
          beforeDeploy: options.beforeDeploy,
        });
        onProgress("Owned validator ready");
        context = await captureDemoContext(
          wallet.address,
          readDemoDevnet,
          deployment.address,
        );
        await mkdir(path.dirname(directory), { recursive: true });
        await mkdir(directory, { recursive: false });
        run = {
          schemaVersion: 1,
          kind: "frameshrink-devnet-case",
          state: "preparing",
          wallet: wallet.address,
          createdAt: new Date().toISOString(),
          directory: path.resolve(directory),
        };
        await checkpoint(directory, run);
        await saveJSON(path.join(directory, "context.json"), context);
        await saveJSON(
          path.join(directory, "validator-deployment.json"),
          deployment,
        );
        await makeCaseGenesis(context, directory);
        await writeFile(
          path.join(directory, "README.txt"),
          "Owned chain-1337 owner-bound experimental validator fixture. Validation mode bits enable TIMESTAMP (1), NUMBER (2), undeployed-owner code access (4), static SSTORE (8), and fixture revert (16) in v3; older validators support opcode cases only. Execution-halting fixture branches are diagnosed before policy-only branches. Zero-value body calls target the owner. Exact signed payloads replay against reconstructed code, balances and nonces with a pinned client/policy. This is relevant captured state, not a full historical chain snapshot. Controlled revert/static-write cases preserve structured frame/halt evidence rather than requiring a trace of execution that never completed. Each debug stage preserves its own exact failure fingerprint; staged corrections expose subsequent selected failures. Intermediate candidates stay local. Final mode 0 skips forbidden reads. Replay requires no key. Rejected admission does not consume a nonce. This is a development fixture, not a production wallet.\n",
        );
        const recipe = parseRecipe({
          ...(await readJSON(ROOT + "fixtures/banned-opcode.json")),
          ...(options.failureMask
            ? {
                family: "validation-fixture",
                name: "validation-failures",
                failureMask: options.failureMask,
              }
            : options.opcodeMask
              ? { opcodeMask: options.opcodeMask }
              : {}),
        });
        original = await buildSignedCase(recipe, context);
        await saveJSON(path.join(directory, "original.json"), original);
      }
      try {
        await startCaseRuntime(directory);
        const profile = await captureCaseProfile(context, directory);
        if (options.resume) {
          const saved = await readJSON(path.join(directory, "profile.json"));
          if (
            saved.profileHash !== profile.profileHash ||
            saved.stateHash !== profile.stateHash
          )
            throw new FrameShrinkError("Captured replay profile changed", 3);
        } else await saveJSON(path.join(directory, "profile.json"), profile);
        if (run.state === "preparing") {
          const baseline = await evaluateSigned(original, context, profile);
          const control = await buildSignedCase(
            { ...original.recipe, family: "verify-gas", prefixGas: 30000 },
            context,
          );
          if (
            baseline.fingerprint?.normalizedCause !==
              expectedCause(original.recipe) ||
            (await evaluateSigned(control, context, profile)).status !==
              "accepted"
          )
            throw new FrameShrinkError(
              "Owned baseline/control is not stable on the local runtime",
              5,
            );
          onProgress(
            "Local checks passed · original rejects, corrected control passes",
          );
          if (
            options.beforeOriginal &&
            !(await options.beforeOriginal(original, context))
          )
            return run;
          run.originalHash = original.hash;
          run.originalFrames = original.frameIds.length;
          run.originalAttemptedAt = new Date().toISOString();
          await checkpoint(directory, run);
          const mode = firstFailure(original.recipe)!;
          const matches = (message: string) =>
            matchesPublicFailure(mode, message, wallet.address);
          let rejection: unknown;
          try {
            const result = await submitDemoSelfRelay(
              decodeSignedCase(original, context).tx,
            );
            await saveJSON(path.join(directory, "public-rejection.json"), {
              unexpectedAcceptance: result,
            });
            throw new FrameShrinkError(
              "Public node accepted the intended failure; stopped before correction",
              5,
            );
          } catch (e) {
            if (
              !(e instanceof DevnetRpcError) ||
              e.uncertain ||
              !matches(e.message)
            )
              throw e;
            rejection = { message: e.message, code: e.rpcCode };
          }
          const detail = await publicDetail(original.hash);
          if (
            detail.admission.outcome !== "rejected" ||
            !detail.admission.checks?.some(
              (c: any) => c.verdict === "fail" && matches(c.detail ?? ""),
            )
          )
            throw new FrameShrinkError(
              "Public rejection does not match the selected failure",
              5,
            );
          await saveJSON(path.join(directory, "public-rejection.json"), {
            response: rejection,
            admission: detail,
            nodeInfo: await readDemoDevnet("skandha_explorer_info", []),
          });
          run.state = "rejected";
          await checkpoint(directory, run);
          onProgress("Public rejection captured · " + mode.label);
          options.onOriginalRejected?.(run);
        }
        const alreadyReduced = run.state === "reduced";
        if (run.state === "rejected") {
          const budget = options.beforeDebug
            ? await options.beforeDebug(run)
            : undefined;
          if (budget === false) return run;
          let current = original;
          const stages: DebugStage[] = [];
          do {
            const evaluations = new Map<string, SignedCase>([
              [hash(current.recipe), current],
            ]);
            const evaluator = async (r: Recipe, p: Profile) => {
              let item = evaluations.get(hash(r));
              if (!item) {
                item = await buildSignedCase(r, context);
                evaluations.set(hash(r), item);
              }
              return evaluateSigned(item, context, p);
            };
            const result = await reduce(
              current.recipe,
              profile,
              budget,
              undefined,
              evaluator,
              (event) =>
                options.onEvaluation?.(
                  stages.length + 1,
                  expectedCause(current.recipe),
                  event,
                ),
            );
            const smaller = evaluations.get(hash(result.reduced));
            if (
              !smaller ||
              !result.baseline.fingerprint ||
              result.baseline.fingerprint.normalizedCause !==
                expectedCause(current.recipe)
            )
              throw new FrameShrinkError(
                "Debug stage did not reproduce its selected failure",
                5,
              );
            const correction = await buildSignedCase(
              correctFailure(smaller.recipe),
              context,
            );
            const remaining = recipeMask(correction.recipe);
            const after = await evaluateSigned(correction, context, profile);
            if (
              remaining
                ? after.fingerprint?.normalizedCause !==
                  expectedCause(correction.recipe)
                : after.status !== "accepted"
            )
              throw new FrameShrinkError(
                "Staged correction did not expose the next failure or pass",
                5,
              );
            const stage: DebugStage = {
              failure: expectedCause(current.recipe),
              original: current,
              reduced: smaller,
              correction,
              evaluations: result.evaluations,
              fingerprint: result.baseline.fingerprint,
            };
            stages.push(stage);
            if (stages.length === 1) {
              await saveJSON(path.join(directory, "reduction.json"), result);
              await saveJSON(path.join(directory, "reduced.json"), smaller);
              run.reducedFrames = smaller.frameIds.length;
              run.originalBytes = result.baseline.bytes;
              run.reducedBytes = result.result.bytes;
            }
            onProgress(
              `Debug ${stages.length} · ${failureLabel(stage.failure)} · ${current.frameIds.length} → ${smaller.frameIds.length} frames · ${result.evaluations} evaluations`,
            );
            current = correction;
            if (!remaining) break;
          } while (stages.length < FAILURE_MODES.length);
          await saveJSON(path.join(directory, "debug-stages.json"), stages);
          await saveJSON(path.join(directory, "corrected.json"), current);
          const replay = await replayOpen(directory);
          await saveJSON(path.join(directory, "local-replay.json"), replay);
          run.replay = replay.status;
          run.state = "reduced";
          await checkpoint(directory, run);
          onProgress("Clean replay passed · all selected failures");
        }
        const corrected = decodeSignedCase(
          await readJSON(path.join(directory, "corrected.json")),
          context,
        ).record;
        const stages: DebugStage[] = await readJSON(
          path.join(directory, "debug-stages.json"),
        );
        if (alreadyReduced) await replayOpen(directory);
        if (
          options.beforeCorrected &&
          !(await options.beforeCorrected(run, corrected, stages, context))
        )
          return run;
        await verifyDevnet(readDemoDevnet);
        const nonce = await readDemoDevnet("eth_getTransactionCount", [
          context.validator?.address ?? wallet.address,
          "latest",
        ]);
        if (
          typeof nonce !== "string" ||
          BigInt(nonce) !== BigInt(context.validator?.nonce ?? context.nonce)
        )
          throw new FrameShrinkError(
            "Wallet nonce changed; corrected submission stopped",
            4,
          );
        run.correctedHash = corrected.hash;
        run.correctedAttemptedAt = new Date().toISOString();
        run.state = "pending";
        await checkpoint(directory, run);
        try {
          const result = await submitDemoSelfRelay(
            decodeSignedCase(corrected, context).tx,
          );
          if (result !== corrected.hash)
            throw new FrameShrinkError(
              "Corrected submission returned another hash",
              4,
            );
        } catch (e) {
          if (!(e instanceof DevnetRpcError) || !e.uncertain) throw e;
        }
        onProgress("Corrected transaction submitted");
        await finishPublic(directory, run);
        if ((run as DemoRun).state === "complete")
          onProgress(
            "Public execution succeeded · block " +
              BigInt(run.blockNumber!).toString(),
          );
        await checkpoint(directory, run);
      } catch (e) {
        const cancelled = ["ExitPromptError", "AbortPromptError"].includes(
          (e as Error).name,
        );
        if (cancelled) {
          if (["rejected", "reduced"].includes(run.state))
            onProgress(
              "Saved · frameshrink start debug " + demoReference(directory),
            );
          throw e;
        }
        // Preserve a known submission as pending so reconciliation remains possible.
        if (!run.correctedAttemptedAt) run.state = "inconclusive";
        run.error = (e as Error).message;
        await checkpoint(directory, run);
        throw new FrameShrinkError(
          (e as Error).message + " · " + directory,
          e instanceof FrameShrinkError ? e.exitCode : 4,
        );
      } finally {
        await sealDemo(directory);
      }
      return run;
    }),
  );
}
export const defaultDemoDirectory = () =>
  path.join(
    DATA_DIRECTORY,
    "demos",
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID().slice(0, 6),
  );

export function demoReference(directory: string): string {
  const relative = path.relative(
    path.join(DATA_DIRECTORY, "demos"),
    path.resolve(directory),
  );
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : path.resolve(directory);
}
export function resolveDemoDirectory(reference: string): string {
  if (path.isAbsolute(reference) || existsSync(path.resolve(reference)))
    return path.resolve(reference);
  if (
    /^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(reference) &&
    !reference.split("/").includes("..")
  )
    return path.join(DATA_DIRECTORY, "demos", reference);
  return path.resolve(reference);
}
