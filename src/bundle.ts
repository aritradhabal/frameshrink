import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  bytesHash,
  saveJSON,
  readJSON,
  hash,
  FrameShrinkError,
} from "./shared.js";
import { parseRecipe } from "./recipe.js";
import { capture, evaluate, type Profile } from "./runtime.js";
import type { Reduction } from "./reducer.js";
const FILES = [
  "recipe.original.json",
  "recipe.reduced.json",
  "profile.json",
  "transaction.original.json",
  "transaction.reduced.json",
  "reports.json",
  "reduction-log.jsonl",
  "regression.json",
  "genesis.json",
  "PayloadSink.sol",
  "PayloadSink.artifact.json",
  "README.md",
];
export async function exportBundle(job: Reduction, directory: string) {
  await mkdir(directory, { recursive: false });
  await saveJSON(path.join(directory, "recipe.original.json"), job.original);
  await saveJSON(path.join(directory, "recipe.reduced.json"), job.reduced);
  await saveJSON(path.join(directory, "profile.json"), job.profile);
  await saveJSON(path.join(directory, "transaction.original.json"), {
    raw: job.baseline.raw,
    frameIds: job.baseline.frameIds,
  });
  await saveJSON(path.join(directory, "transaction.reduced.json"), {
    raw: job.result.raw,
    frameIds: job.result.frameIds,
  });
  await saveJSON(path.join(directory, "reports.json"), {
    baseline: job.baseline,
    reduced: job.result,
    control: job.control,
  });
  await writeFile(
    path.join(directory, "reduction-log.jsonl"),
    job.attempts.map((a) => JSON.stringify(a)).join("\n") + "\n",
  );
  await saveJSON(path.join(directory, "regression.json"), {
    fingerprint: job.baseline.fingerprint,
    locallyMinimal: job.locallyMinimal,
    termination: job.termination,
    evaluations: job.evaluations,
    durationMs: job.durationMs,
    editSet: job.editSet,
  });
  for (const [source, dest] of [
    ["fixtures/genesis.json", "genesis.json"],
    ["contracts/PayloadSink.sol", "PayloadSink.sol"],
    ["contracts/PayloadSink.artifact.json", "PayloadSink.artifact.json"],
  ])
    await writeFile(path.join(directory, dest), await readFile(ROOT + source));
  await writeFile(
    path.join(directory, "README.md"),
    "# FrameShrink local regression\n\nFrom the pinned FrameShrink checkout, run `npm run cli -- replay /absolute/path/to/this-bundle`. Replay resets the dedicated frameshrink-ethrex container and reconstructs genesis. It verifies every checksum, runtime identity, signatures and both failure fingerprints, then tests the corrected control.\n\nThe signed payloads use a public disposable local signer and intentionally unconditional APPROVE fixture wallet. Never fund or deploy it publicly. No private keys or provider secrets are in this bundle.\n\nPolicy scope excludes full mempool admission, fees, replacement, reputation admission and gossip. Local minimality applies only to the listed typed edit set; gas quantities are held fixed. This bundle is a local regression case, not public admission or execution evidence.\n",
  );
  const checksums: Record<string, string> = {};
  for (const file of FILES)
    checksums[file] = bytesHash(await readFile(path.join(directory, file)));
  await saveJSON(path.join(directory, "manifest.json"), {
    schemaVersion: 1,
    kind: "frameshrink-regression",
    reproductionStatus: "local-replay-required",
    checksums,
    profileHash: job.profile.profileHash,
    stateHash: job.profile.stateHash,
  });
}
export async function verifyBundle(directory: string) {
  const base = await realpath(directory);
  const entries = await readdir(base);
  if (
    entries.length !== FILES.length + 1 ||
    entries.some((f) => !FILES.includes(f) && f !== "manifest.json")
  )
    throw new FrameShrinkError("Unexpected bundle files", 2);
  for (const file of entries) {
    const s = await lstat(path.join(base, file));
    if (!s.isFile() || s.isSymbolicLink() || s.size > 4 * 1024 * 1024)
      throw new FrameShrinkError(
        "Bundle entries must be bounded regular files",
        2,
      );
  }
  const manifest = await readJSON(path.join(base, "manifest.json"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "frameshrink-regression" ||
    Object.keys(manifest.checksums ?? {})
      .sort()
      .join() !== [...FILES].sort().join()
  )
    throw new FrameShrinkError("Invalid bundle manifest", 2);
  for (const file of FILES)
    if (
      bytesHash(await readFile(path.join(base, file))) !==
      manifest.checksums[file]
    )
      throw new FrameShrinkError("Checksum mismatch: " + file, 5);
  if (
    bytesHash(await readFile(path.join(base, "genesis.json"))) !==
    bytesHash(await readFile(ROOT + "fixtures/genesis.json"))
  )
    throw new FrameShrinkError("Bundle requires a different genesis", 3);
  return { manifest, base };
}
export async function replay(directory: string) {
  const { manifest, base } = await verifyBundle(directory);
  const profile = await capture();
  const saved: Profile = await readJSON(path.join(base, "profile.json"));
  if (
    saved.profileHash !== profile.profileHash ||
    manifest.profileHash !== profile.profileHash ||
    manifest.stateHash !== profile.stateHash
  )
    throw new FrameShrinkError(
      "Replay runtime/profile differs from exported environment",
      3,
    );
  const expected = await readJSON(path.join(base, "regression.json"));
  const original = parseRecipe(
      await readJSON(path.join(base, "recipe.original.json")),
    ),
    reduced = parseRecipe(
      await readJSON(path.join(base, "recipe.reduced.json")),
    );
  const results = [];
  for (const [name, recipe] of [
    ["original", original],
    ["reduced", reduced],
  ] as const) {
    const result = await evaluate(recipe, profile);
    const tx = await readJSON(path.join(base, `transaction.${name}.json`));
    if (
      result.raw !== tx.raw ||
      hash(result.frameIds) !== hash(tx.frameIds) ||
      hash(result.fingerprint) !== hash(expected.fingerprint)
    )
      throw new FrameShrinkError(`Regression mismatch: ${name}`, 5);
    results.push({
      name,
      status: result.status,
      bytes: result.bytes,
      message: result.message,
    });
  }
  const control = await evaluate(
    { ...reduced, family: "verify-gas", prefixGas: 30000 },
    profile,
  );
  if (control.status !== "accepted")
    throw new FrameShrinkError("Corrected control failed replay", 5);
  return {
    schemaVersion: 1,
    status: "reproduced",
    cleanState: profile.headNumber === "0x0",
    profileHash: profile.profileHash,
    results,
    control: control.status,
  };
}
