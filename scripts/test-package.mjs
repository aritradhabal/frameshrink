import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "frameshrink-package-"));
const runtime = process.argv.includes("--runtime");
const expectedVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const report = Array.isArray(packed)
    ? packed[0]
    : packed.files
      ? packed
      : Object.values(packed)[0];
  assert.equal(report.name, "frameshrink");
  const names = report.files.map((file) => file.path);
  assert(
    names.includes("dist/cli.js") &&
      names.includes("dist/build.json") &&
      names.includes("dist/third-party-notices.txt"),
  );
  assert(names.includes("examples/expanded-all-five/manifest.json"));
  assert(
    !names.some((name) =>
      /(^|\/)(\.runs|\.vendor|\.tools|\.git|node_modules)(\/|$)/.test(name),
    ),
  );
  assert(!names.some((name) => /\.(ts|key|pem)$/.test(name)));
  const archive = path.join(temporary, report.filename);
  const installed = path.join(temporary, "installed"),
    execOnly = path.join(temporary, "exec-only"),
    cache = path.join(temporary, "cache");
  await mkdir(installed);
  await mkdir(execOnly);
  await writeFile(path.join(execOnly, "package.json"), '{"private":true}\n');
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      installed,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const packageRoot = path.join(installed, "node_modules/frameshrink");
  for (const missing of [".vendor", ".tools", "src/cli.ts"])
    await assert.rejects(() => access(path.join(packageRoot, missing)));
  const fake = path.join(temporary, "blocked-tools");
  await mkdir(fake);
  for (const command of ["git", "bun"]) {
    const file = path.join(fake, command);
    await writeFile(
      file,
      '#!/bin/sh\necho "Unexpected build tool call" >&2\nexit 99\n',
    );
    await chmod(file, 0o755);
  }
  const state = path.join(temporary, "state");
  const env = {
    ...process.env,
    FRAMESHRINK_HOME: state,
    PATH: fake + path.delimiter + process.env.PATH,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  const cli = path.join(packageRoot, "bin/frameshrink.mjs");
  const help = execFileSync(process.execPath, [cli, "--help"], {
    cwd: installed,
    env,
    encoding: "utf8",
  });
  assert(help.includes("demo local"));
  const version = execFileSync(process.execPath, [cli, "--version"], {
    cwd: installed,
    env,
    encoding: "utf8",
  }).trim();
  assert.equal(version, expectedVersion);
  const failures = JSON.parse(
    execFileSync(process.execPath, [cli, "failures", "--json"], {
      cwd: installed,
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(failures.families.length, 20);
  const identity = JSON.parse(
    execFileSync(process.execPath, [cli, "wallet", "create", "--json"], {
      cwd: installed,
      env,
      encoding: "utf8",
    }),
  );
  assert(identity.created);
  const stored = JSON.parse(
    await readFile(path.join(state, "wallet/key.json"), "utf8"),
  );
  assert.equal(stored.address, identity.address);
  assert(!JSON.stringify(identity).includes(stored.privateKey));
  await assert.rejects(() => access(path.join(packageRoot, ".runs")));
  const execArgs = [
    "exec",
    "--yes",
    "--cache",
    cache,
    "--package=" + archive,
    "--",
    "frameshrink",
  ];
  const execHelp = execFileSync("npm", [...execArgs, "--help"], {
    cwd: execOnly,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  assert(execHelp.includes("demo local"));
  await assert.rejects(() => access(path.join(execOnly, "node_modules")));
  const brokenDocker = path.join(fake, "docker");
  await writeFile(brokenDocker, "#!/bin/sh\nexit 1\n");
  await chmod(brokenDocker, 0o755);
  const missingState = path.join(temporary, "missing-docker-state");
  const missingDocker = spawnSync(
    process.execPath,
    [cli, "demo", "local", "--json"],
    {
      cwd: installed,
      env: { ...env, FRAMESHRINK_HOME: missingState },
      encoding: "utf8",
    },
  );
  assert.equal(missingDocker.status, 3);
  assert(missingDocker.stderr.includes("Docker is not responding"));
  await assert.rejects(() => access(missingState));
  await rm(brokenDocker);
  if (runtime) {
    const runtimeReady = JSON.parse(
      execFileSync(process.execPath, [cli, "runtime", "up", "--json"], {
        cwd: installed,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      }),
    );
    assert.equal(runtimeReady.status, "ready");
    assert.equal(runtimeReady.chainId, 9);
    const sampleState = path.join(temporary, "sample-state");
    const sample = JSON.parse(
      execFileSync("npm", [...execArgs, "demo", "local", "--json"], {
        cwd: execOnly,
        env: { ...env, FRAMESHRINK_HOME: sampleState },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      }),
    );
    assert.equal(sample.status, "reproduced");
    assert.equal(sample.networkWrites, false);
    assert.equal(
      sample.results.filter((item) => item.name.startsWith("stage-")).length,
      5,
    );
    assert.equal(
      sample.results.find((item) => item.name === "corrected").status,
      "accepted",
    );
    await assert.rejects(() => access(path.join(sampleState, "wallet")));
    const human = execFileSync(process.execPath, [cli, "demo", "--no-color"], {
      cwd: installed,
      env: { ...env, FRAMESHRINK_HOME: sampleState },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    assert(!human.includes(temporary));
    assert(human.includes("[PASSED]"));
  }
  const bundleFile = path.join(packageRoot, "dist/cli.js");
  const originalBundle = await readFile(bundleFile);
  try {
    await writeFile(
      bundleFile,
      Buffer.concat([originalBundle, Buffer.from("\n// tamper test\n")]),
    );
    const tampered = spawnSync(process.execPath, [cli, "doctor", "--json"], {
      cwd: installed,
      env,
      encoding: "utf8",
    });
    assert.equal(tampered.status, 3);
    assert((tampered.stdout + tampered.stderr).includes("build manifest"));
  } finally {
    await writeFile(bundleFile, originalBundle);
  }
  const result = {
    schemaVersion: 1,
    package: report.filename,
    compressedBytes: report.size,
    unpackedBytes: report.unpackedSize,
    installedWithScriptsDisabled: true,
    noGitOrBunRequired: true,
    execWithoutGlobalInstall: true,
    runtimeReplay: runtime ? "passed" : "not run",
    secretsExcluded: true,
    modifiedBundleRefused: true,
    dockerFailureActionable: true,
    runtimeJsonReady: runtime ? "passed" : "not run",
    files: report.files.map((file) => file.path),
  };
  await writeFile(
    path.join(root, "evidence/package-check.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Package install, state isolation and npm exec checks passed" +
      (runtime ? " · real five-stage replay passed" : ""),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
