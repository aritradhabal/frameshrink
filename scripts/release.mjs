import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  readdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
async function release() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const out = path.resolve(
    process.argv[2] ?? path.join(root, "../output/frameshrink-release"),
  );
  if (!process.env.npm_execpath)
    throw Error("Use npm run release:local -- /output/directory");
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw Error("Commit the reviewed source before creating a release.");
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const head = git("rev-parse", "HEAD");
  const tag = "v" + version;
  let tagged;
  try {
    tagged = git("rev-parse", "--verify", tag + "^{commit}");
  } catch {}
  if (tagged && tagged !== head)
    throw Error("Release tag belongs to another commit; bump the version.");
  if (!tagged)
    throw Error(
      `Create the reviewed release tag first: git tag -a ${tag} -m 'FrameShrink ${version}'`,
    );
  await mkdir(out, { recursive: true });
  const archiveOld = async (file, oldVersion) => {
    const directory = path.join(out, "archive", oldVersion);
    await mkdir(directory, { recursive: true });
    try {
      const existing = await readFile(path.join(directory, file));
      if (!existing.equals(await readFile(path.join(out, file))))
        throw Error("Archived artifact differs: " + file);
      await rm(path.join(out, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await rename(path.join(out, file), path.join(directory, file));
    }
  };
  let oldVersion;
  try {
    oldVersion = (await readFile(path.join(out, "RELEASE.txt"), "utf8")).match(
      /^FrameShrink (\S+)/,
    )?.[1];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (oldVersion && oldVersion !== version) {
    for (const file of [
      "frameshrink-source.zip",
      "frameshrink.git.bundle",
      "SHA256SUMS",
      "RELEASE.txt",
    ])
      if ((await readdir(out)).includes(file))
        await archiveOld(file, oldVersion);
  }
  for (const file of await readdir(out)) {
    const match = /^frameshrink-(\d+\.\d+\.\d+)\.tgz$/.exec(file);
    if (match && match[1] !== version) await archiveOld(file, match[1]);
  }
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, "pack", "--pack-destination", out],
    { cwd: root, stdio: "inherit" },
  );
  git("bundle", "create", path.join(out, "frameshrink.git.bundle"), "--all");
  git("bundle", "verify", path.join(out, "frameshrink.git.bundle"));
  const clone = await mkdtemp(
    path.join(tmpdir(), "frameshrink-release-clone-"),
  );
  try {
    execFileSync("git", [
      "clone",
      "--quiet",
      path.join(out, "frameshrink.git.bundle"),
      path.join(clone, "repo"),
    ]);
    if (
      execFileSync(
        "git",
        ["-C", path.join(clone, "repo"), "rev-parse", "HEAD"],
        {
          encoding: "utf8",
        },
      ).trim() !== head
    )
      throw Error("Git bundle clone does not match release commit");
  } finally {
    await rm(clone, { recursive: true, force: true });
  }
  git(
    "archive",
    "--format=zip",
    "--prefix=frameshrink/",
    "--output=" + path.join(out, "frameshrink-source.zip"),
    "HEAD",
  );
  const files = [
    `frameshrink-${version}.tgz`,
    "frameshrink-source.zip",
    "frameshrink.git.bundle",
  ];
  const checksums = [];
  for (const file of files)
    checksums.push(
      createHash("sha256")
        .update(await readFile(path.join(out, file)))
        .digest("hex") +
        "  " +
        file,
    );
  await writeFile(path.join(out, "SHA256SUMS"), checksums.join("\n") + "\n");
  await writeFile(
    path.join(out, "RELEASE.txt"),
    `FrameShrink ${version}
Git commit: ${head}
Git tag: ${tag}
Local release artifacts for the public frameshrink CLI.
Registry publishing is a separate authenticated npm publish action.
Source repository: https://github.com/aritradhabal/frameshrink
This command does not upload artifacts to a registry or Git remote.

Try without global installation (Node.js 22.13+ in 22.x or 24+, Docker for replay):
npm exec --yes --package=./frameshrink-${version}.tgz -- frameshrink demo

Install:
npm install --global ./frameshrink-${version}.tgz
frameshrink start transaction

Clone history:
git clone ./frameshrink.git.bundle frameshrink

Use --no-open to suppress browser opening, --verbose for all local checks.
The shared runtime lock is independent of FRAMESHRINK_HOME.
Verification: see docs/VERIFICATION.md and evidence/review-fixes.json in source ZIP.
SHA256SUMS covers the current npm tarball, source ZIP and Git bundle.
Earlier release files are retained under archive/<version>/.
`,
  );
  console.log(`Prepared unpublished release ${version} at ${out}`);
}
try {
  await release();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
