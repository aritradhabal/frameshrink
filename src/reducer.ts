import { performance } from "node:perf_hooks";
import { applyEdit, neighbors, type Edit, type Recipe } from "./recipe.js";
import { evaluate, type Evaluation, type Profile } from "./runtime.js";
import { hash, FrameShrinkError } from "./shared.js";
export type Attempt = {
  index: number;
  edit: Edit;
  accepted: boolean;
  cached: boolean;
  reason: string;
  candidateHash: string;
  bytes: number;
};
export type Reduction = {
  schemaVersion: 1;
  status: "reduced" | "unchanged";
  profile: Profile;
  original: Recipe;
  reduced: Recipe;
  baseline: Evaluation;
  result: Evaluation;
  control: Evaluation;
  attempts: Attempt[];
  evaluations: number;
  durationMs: number;
  termination: "locally-minimal" | "evaluation-budget" | "time-budget";
  locallyMinimal: boolean;
  editSet: string[];
};
export type EvaluationEvent = {
  evaluation: number;
  phase: "baseline" | "repeat" | "control" | "candidate";
  edit?: Edit;
  status: Evaluation["status"];
  bytes: number;
  sameFailure: boolean | null;
  cause: string | null;
};
export type Budget = { maxEvaluations: number; maxDurationMs: number };
export async function reduce(
  original: Recipe,
  profile: Profile,
  budget: Budget = { maxEvaluations: 80, maxDurationMs: 120000 },
  onProgress?: (a: Attempt) => void,
  evaluator = evaluate,
  onEvaluation?: (event: EvaluationEvent) => void,
): Promise<Reduction> {
  if (
    !Number.isInteger(budget.maxEvaluations) ||
    budget.maxEvaluations < 4 ||
    budget.maxEvaluations > 80 ||
    budget.maxDurationMs < 100 ||
    budget.maxDurationMs > 120000
  )
    throw new FrameShrinkError(
      "Budget must be 4–80 evaluations and 100–120000 ms",
      2,
    );
  const start = performance.now();
  let evaluations = 0;
  let baselineFingerprint: Evaluation["fingerprint"] = null;
  const call = async (
    r: Recipe,
    phase: EvaluationEvent["phase"],
    edit?: Edit,
  ) => {
    if (evaluations >= budget.maxEvaluations)
      throw new FrameShrinkError("Baseline/control exceeded evaluation budget");
    if (performance.now() - start >= budget.maxDurationMs)
      throw new FrameShrinkError("Baseline/control exceeded time budget");
    evaluations++;
    const result = await evaluator(r, profile);
    onEvaluation?.({
      evaluation: evaluations,
      phase,
      edit,
      status: result.status,
      bytes: result.bytes,
      sameFailure: baselineFingerprint
        ? hash(result.fingerprint) === hash(baselineFingerprint)
        : null,
      cause: result.fingerprint?.normalizedCause ?? null,
    });
    return result;
  };
  const baseline = await call(original, "baseline");
  if (!baseline.fingerprint)
    throw new FrameShrinkError("Baseline does not reject", 5);
  baselineFingerprint = baseline.fingerprint;
  const repeated = await call(original, "repeat");
  if (
    hash(repeated.fingerprint) !== hash(baseline.fingerprint) ||
    repeated.raw !== baseline.raw
  )
    throw new FrameShrinkError("Unstable baseline");
  const controlRecipe = {
    ...original,
    family: "verify-gas" as const,
    prefixGas: 30000,
  };
  const control = await call(controlRecipe, "control");
  if (control.status !== "accepted")
    throw new FrameShrinkError(
      "Corrected control does not pass: " + control.message,
      5,
    );
  let current = structuredClone(original),
    result = baseline;
  const attempts: Attempt[] = [];
  const cache = new Map<string, Evaluation>([
    [
      hash({
        recipe: original,
        profile: profile.profileHash,
        state: profile.stateHash,
      }),
      baseline,
    ],
  ]);
  let termination: Reduction["termination"] = "locally-minimal";
  const exhausted = () => {
    if (performance.now() - start >= budget.maxDurationMs) {
      termination = "time-budget";
      return true;
    }
    if (evaluations >= budget.maxEvaluations) {
      termination = "evaluation-budget";
      return true;
    }
    return false;
  };
  async function attempt(edit: Edit): Promise<boolean> {
    if (exhausted()) return false;
    const candidate = applyEdit(current, edit);
    const key = hash({
      recipe: candidate,
      profile: profile.profileHash,
      state: profile.stateHash,
    });
    let verdict = cache.get(key);
    const cached = !!verdict;
    if (!verdict) {
      verdict = await call(candidate, "candidate", edit);
      cache.set(key, verdict);
    }
    const accepted =
      hash(verdict.fingerprint) === hash(baseline.fingerprint) &&
      verdict.bytes < result.bytes;
    const entry = {
      index: attempts.length + 1,
      edit,
      accepted,
      cached,
      reason: accepted
        ? "Preserves the exact baseline fingerprint and reduces canonical bytes"
        : verdict.message,
      candidateHash: hash(candidate),
      bytes: verdict.bytes,
    };
    attempts.push(entry);
    onProgress?.(entry);
    if (accepted) {
      current = candidate;
      result = verdict;
    }
    return accepted;
  }
  // Deterministic coarse-to-fine delta debugging over independent body calls.
  let width = Math.max(
    1,
    Math.ceil(current.body.filter((b) => !b.required).length / 2),
  );
  while (!exhausted()) {
    const optional = current.body.filter((b) => !b.required).map((b) => b.id);
    if (!optional.length) break;
    let kept = false;
    for (let i = 0; i < optional.length && !exhausted(); i += width)
      if (
        await attempt({
          kind: "remove-frames",
          ids: optional.slice(i, i + width),
        })
      ) {
        kept = true;
        break;
      }
    if (!kept) {
      if (width === 1) break;
      width = Math.max(1, Math.floor(width / 2));
    }
  }
  for (const id of current.body.map((b) => b.id)) {
    let size = Math.max(
      1,
      current.body.find((b) => b.id === id)!.values.length,
    );
    while (size >= 1 && !exhausted()) {
      let changed = false;
      const length = current.body.find((b) => b.id === id)!.values.length;
      for (let i = 0; i < length && !exhausted(); i += size)
        if (
          await attempt({
            kind: "remove-values",
            id,
            start: i,
            count: Math.min(size, length - i),
          })
        ) {
          changed = true;
          break;
        }
      if (!changed) size = Math.floor(size / 2);
    }
  }
  // A completed supported-neighbor pass, rather than the earlier search, establishes local minimality.
  let complete = false;
  while (!exhausted()) {
    let changed = false;
    const edits = neighbors(current);
    for (const edit of edits) {
      if (exhausted()) break;
      if (await attempt(edit)) {
        changed = true;
        break;
      }
    }
    if (exhausted()) break;
    if (!changed) {
      complete = true;
      break;
    }
  }
  if (complete) termination = "locally-minimal";
  return {
    schemaVersion: 1,
    status: result.bytes < baseline.bytes ? "reduced" : "unchanged",
    profile,
    original,
    reduced: current,
    baseline,
    result,
    control,
    attempts,
    evaluations,
    durationMs: Math.round(performance.now() - start),
    termination,
    locallyMinimal: complete,
    editSet: [
      "remove independent optional body frame",
      "remove uint256[] element using ABI re-encoding",
    ],
  };
}
