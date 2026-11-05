import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  vendor = root + ".vendor/sidecar",
  pin = "2e22ff0a2898e69ea4bf5275bce1be8581a8582a";
mkdirSync(root + ".vendor", { recursive: true });
if (!existsSync(vendor)) {
  execFileSync(
    "git",
    [
      "clone",
      "--no-checkout",
      "https://github.com/forshtat/mempool-workshop-sidecar.git",
      vendor,
    ],
    { stdio: "inherit" },
  );
  execFileSync("git", ["-C", vendor, "checkout", "--detach", pin], {
    stdio: "inherit",
  });
}
if (
  execFileSync("git", ["-C", vendor, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim() !== pin
)
  throw Error(
    "Existing vendor is at a different commit; refusing to overwrite it",
  );
if (
  execFileSync(
    "git",
    ["-C", vendor, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).trim()
)
  throw Error("Existing vendor has modified source; refusing to build it");
const platform = { darwin: "darwin", linux: "linux" }[process.platform],
  arch = { arm64: "aarch64", x64: "x64" }[process.arch];
if (!platform || !arch)
  throw Error("Bootstrap currently supports macOS/Linux on arm64/x64");
const pkg = `@oven/bun-${platform}-${arch}`,
  bun = root + `.tools/node_modules/${pkg}/bin/bun`;
if (!existsSync(bun))
  execFileSync(
    "npm",
    ["install", "--prefix", root + ".tools", "--save-exact", pkg + "@1.3.11"],
    { stdio: "inherit" },
  );
const env = {
  ...process.env,
  PATH: fileURLToPath(new URL(".", `file://${bun}`)) + ":" + process.env.PATH,
};
execFileSync(bun, ["install", "--frozen-lockfile"], {
  cwd: vendor,
  stdio: "inherit",
  env,
});
execFileSync(bun, ["run", "build"], { cwd: vendor, stdio: "inherit", env });
console.log(
  "Pinned sidecar built. Run npm run runtime:up, npm run verify, then npm start.",
);
