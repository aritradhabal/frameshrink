import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exclusive } from "../src/lock.js";
import {
  withRuntimeLock,
  RUNTIME_LOCK_DIRECTORY,
} from "../scripts/runtime-lock.mjs";
import { ROOT } from "../src/shared.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

async function isolated(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "frameshrink-lock-"));
  try {
    await fn(directory);
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
}

test("simultaneous runtime contenders never enter together and leave no locks", async () => {
  await isolated(async (directory) => {
    let active = 0,
      maximum = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        exclusive(
          async () => {
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 30));
            active--;
          },
          { directory },
        ),
      ),
    );
    assert.equal(maximum, 1);
    assert(results.some((result) => result.status === "fulfilled"));
    for (const result of results) {
      if (result.status === "rejected")
        assert.match(result.reason.message, /Another FrameShrink job/);
    }
    assert.deepEqual(await readdir(directory), []);
  });
});

test("runtime recovers a real killed process without deleting a live or unknown lock", async () => {
  await isolated(async (directory) => {
    const source = new URL("../src/lock.ts", import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { exclusive } from ${JSON.stringify(source)};
       await exclusive(async () => {
         console.log("ready");
         await new Promise(() => setInterval(() => {}, 1000));
       }, { directory: ${JSON.stringify(directory)} });`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    try {
      const output = await Promise.race([
        once(child.stdout!, "data").then(([data]) => String(data)),
        exited.then(() => {
          throw new Error("Lock holder exited before acquiring");
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Lock holder did not start")),
            5000,
          ).unref(),
        ),
      ]);
      assert.match(output, /ready/);
      await assert.rejects(
        () => exclusive(async () => {}, { directory }),
        /Another FrameShrink job/,
      );
      child.kill("SIGKILL");
      await exited;
      let active = 0,
        maximum = 0;
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          exclusive(
            async () => {
              active++;
              maximum = Math.max(maximum, active);
              await new Promise((resolve) => setTimeout(resolve, 20));
              active--;
            },
            { directory },
          ),
        ),
      );
      assert.equal(maximum, 1);
      assert(results.some((result) => result.status === "fulfilled"));
      assert.deepEqual(await readdir(directory), []);
      // Old releases wrote just the PID; retain safe recovery for those files.
      await writeFile(path.join(directory, "runtime.lock"), String(child.pid));
      await exclusive(async () => {}, { directory });
      assert.deepEqual(await readdir(directory), []);
      for (const value of [
        String(process.pid),
        "unknown owner",
        JSON.stringify({ pid: -1 }),
      ]) {
        await writeFile(path.join(directory, "runtime.lock"), value);
        await assert.rejects(
          () => exclusive(async () => {}, { directory }),
          /Another FrameShrink job/,
        );
        assert.equal(
          await readFile(path.join(directory, "runtime.lock"), "utf8"),
          value,
        );
      }
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  });
});

test("runtime cleanup preserves a replacement owner's token and original operation errors", async () => {
  await isolated(async (directory) => {
    const sentinel = new Error("Original failure");
    await assert.rejects(
      () =>
        exclusive(
          async () => {
            throw sentinel;
          },
          { directory },
        ),
      (error) => error === sentinel,
    );
    assert.deepEqual(await readdir(directory), []);
    const token = "ab".repeat(16);
    const replacement = JSON.stringify({ pid: process.pid, token });
    await exclusive(
      async () => {
        await rename(
          path.join(directory, "runtime.lock.d"),
          path.join(directory, "old-owner"),
        );
        await mkdir(path.join(directory, "runtime.lock.d"));
        await writeFile(
          path.join(directory, "runtime.lock.d", `owner-${token}.json`),
          replacement,
        );
        await unlink(path.join(directory, "runtime.lock"));
        await writeFile(path.join(directory, "runtime.lock"), replacement);
      },
      { directory },
    );
    assert.equal(
      await readFile(path.join(directory, "runtime.lock"), "utf8"),
      replacement,
    );
    assert.equal(
      await readFile(
        path.join(directory, "runtime.lock.d", `owner-${token}.json`),
        "utf8",
      ),
      replacement,
    );
  });
});

test("filesystem access errors do not masquerade as runtime contention", async () => {
  await isolated(async (directory) => {
    const file = path.join(directory, "not-a-directory");
    await writeFile(file, "file");
    await assert.rejects(
      () => exclusive(async () => {}, { directory: file }),
      /Could not access the runtime lock/,
    );
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      await chmod(directory, 0o500);
      await assert.rejects(
        () => exclusive(async () => {}, { directory }),
        /Could not access the runtime lock \(EACCES\)/,
      );
    }
  });
});

test("separate data directories and runtime management share one default process lock", async () => {
  await exclusive(async () => {
    for (const state of ["source-data", "installed-data"]) {
      const result = await execute(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import { exclusive } from ${JSON.stringify(new URL("../src/lock.ts", import.meta.url).href)};
         import { DATA_DIRECTORY } from ${JSON.stringify(new URL("../src/shared.ts", import.meta.url).href)};
         try { await exclusive(async () => console.log("entered")); }
         catch (error) { console.log(JSON.stringify({message:error.message, directory: DATA_DIRECTORY})); }`,
        ],
        {
          env: { ...process.env, FRAMESHRINK_HOME: path.join(tmpdir(), state) },
        },
      );
      const record = JSON.parse(result.stdout);
      assert.match(record.message, /Another FrameShrink job/);
      assert(record.directory.endsWith(state));
    }
    await assert.rejects(
      () => execute(process.execPath, [ROOT + "scripts/runtime.mjs", "down"]),
      (error: unknown) => {
        assert.match(
          (error as { stderr: string }).stderr,
          /Another FrameShrink job/,
        );
        return true;
      },
    );
    // In-process reconstruction can reset the fixture while retaining ownership.
    await withRuntimeLock(async () =>
      assert.equal(
        JSON.parse(
          await readFile(
            path.join(RUNTIME_LOCK_DIRECTORY, "runtime.lock"),
            "utf8",
          ),
        ).pid,
        process.pid,
      ),
    );
  });
});
