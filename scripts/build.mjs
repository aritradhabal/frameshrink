import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const pin = "2e22ff0a2898e69ea4bf5275bce1be8581a8582a";
const vendor = path.join(root, ".vendor/sidecar");
if (
  execFileSync("git", ["-C", vendor, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim() !== pin ||
  execFileSync(
    "git",
    ["-C", vendor, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).trim()
)
  throw Error(
    "Build requires the clean pinned sidecar checkout; run npm run bootstrap",
  );
await mkdir(path.join(root, "dist"), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  external: ["@inquirer/prompts"],
  legalComments: "external",
  charset: "utf8",
  define: { __FRAMESHRINK_PACKAGED__: "true" },
  banner: {
    js: 'import { createRequire as __frameshrinkCreateRequire } from "node:module"; const require = __frameshrinkCreateRequire(import.meta.url);',
  },
});
// Preserve licenses for all bundled packages; runtime dependencies retain their own notices.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  let directory = path.dirname(path.resolve(root, input));
  while (directory.startsWith(root) && directory !== root) {
    try {
      const pkg = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      );
      packages.set(directory, pkg);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }
}
const notices = [
  "FrameShrink bundled dependencies",
  "",
  await readFile(path.join(vendor, "LICENSE"), "utf8"),
];
for (const [directory, pkg] of [...packages].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  notices.push(
    `\n--- ${pkg.name}@${pkg.version} (${pkg.license ?? "see upstream license"}) ---\n`,
  );
  const names = (await readdir(directory)).filter((name) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(name),
  );
  for (const name of names)
    notices.push(await readFile(path.join(directory, name), "utf8"));
  if (!names.length && directory.startsWith(path.join(vendor, "packages")))
    notices.push("Covered by the upstream sidecar MIT license above.");
}
await writeFile(
  path.join(root, "dist/third-party-notices.txt"),
  notices.join("\n"),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
await writeFile(
  path.join(root, "dist/build.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      sidecarCommit: pin,
      ethrexCommit: "9aa3645d795945c64400f41a70aace0edfa7f383",
      image:
        "ghcr.io/forshtat/eip8141-devnet@sha256:09e0871af79cb06ee3cf3f7bc760a39bdcb539bc9c8d1ef1fe8a1bf57962030e",
      cliSha256: sha(await readFile(path.join(root, "dist/cli.js"))),
      bundledPackages: [...packages.values()].map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Built standalone CLI with pinned sidecar and bundled dependency notices.",
);
