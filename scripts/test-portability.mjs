import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const archive = process.argv[2] && path.resolve(process.argv[2]);
if (!archive || !process.env.npm_execpath)
  throw Error(
    "Use npm run test:portability -- /absolute/path/to/frameshrink.tgz",
  );
const temporary = await mkdtemp(path.join(tmpdir(), "frameshrink-portable-"));
let server;
try {
  const installed = path.join(temporary, "installed");
  await mkdir(installed);
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "install",
      "--prefix",
      installed,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { stdio: "pipe", timeout: 120000 },
  );
  const packageRoot = path.join(installed, "node_modules/frameshrink");
  const cli = path.join(packageRoot, "bin/frameshrink.mjs");
  const env = {
    ...process.env,
    FRAMESHRINK_HOME: path.join(temporary, "data"),
    FRAMESHRINK_NO_OPEN: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  const run = (args, overrides = {}) =>
    execFileSync(process.execPath, [cli, ...args], {
      env: { ...env, ...overrides },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });
  const pkg = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(run(["--version"]).trim(), pkg.version);
  const help = run(["--help", "--no-color"]);
  assert(help.includes("start transaction") && !help.includes("\x1b"));
  const wallet = JSON.parse(run(["wallet", "create", "--json"]));
  assert.match(wallet.address, /^0x[0-9a-fA-F]{40}$/);
  assert(!JSON.stringify(wallet).includes("privateKey"));
  const lock = await import(
    pathToFileURL(path.join(packageRoot, "scripts/runtime-lock.mjs")).href
  );
  await lock.withRuntimeLock(async () => {
    for (const home of ["first", "second"]) {
      assert.throws(
        () =>
          run(["runtime", "down", "--json"], {
            FRAMESHRINK_HOME: path.join(temporary, home),
          }),
        (error) => {
          const result = JSON.parse(String(error.stderr));
          assert.equal(result.exitCode, 4);
          assert.match(result.message, /Another FrameShrink job/);
          return true;
        },
      );
    }
  });
  server = spawn(process.execPath, [cli, "serve", "--port", "0", "--json"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  server.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 10000;
  let ready;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw Error("Workbench startup failed: " + stderr);
    try {
      ready = JSON.parse(stdout);
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(ready?.status, "ready");
  assert.equal((await fetch(ready.url)).status, 200);
  assert.throws(
    () => run(["serve", "--port", new URL(ready.url).port, "--json"]),
    (error) => {
      const result = JSON.parse(String(error.stderr));
      assert.equal(result.exitCode, 3);
      assert.match(result.message, /port .* is in use/);
      assert(!String(error.stderr).includes("node:events"));
      return true;
    },
  );
  const report = {
    schemaVersion: 1,
    version: pkg.version,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    install: "passed",
    wallet: "passed",
    sharedRuntimeLock: "passed",
    jsonWorkbench: "passed",
    occupiedPort: "passed",
    publicSubmissions: 0,
    desktopLaunch: "not exercised",
  };
  const target =
    process.env.FRAMESHRINK_PORTABILITY_REPORT ??
    path.join(
      root,
      `evidence/portability-${process.platform}-${process.arch}.json`,
    );
  await writeFile(target, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Packaged portability checks passed · ${process.platform}/${process.arch} · Node ${process.version}`,
  );
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
