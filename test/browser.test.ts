import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserEnabled,
  browserCommand,
  openExplorer,
} from "../src/browser.js";
import { DEVNET } from "../src/devnet.js";

const url = `https://explorer.altmempool.wtf/tx/0x${"ab".repeat(32)}?node=${encodeURIComponent(DEVNET.primary)}`;
const interactive = { stdinTTY: true, stdoutTTY: true, env: {} };

test("automatic browser opening is interactive only and respects every opt-out", () => {
  assert(browserEnabled(interactive));
  for (const option of [
    { disabled: true },
    { machine: true },
    { stdinTTY: false },
    { stdoutTTY: false },
    { env: { CI: "true" } },
    { env: { FRAMESHRINK_NO_OPEN: "1" } },
    { env: { TERM: "dumb" } },
  ])
    assert.equal(browserEnabled({ ...interactive, ...option }), false);
  assert(
    browserEnabled({
      ...interactive,
      env: { CI: "false", FRAMESHRINK_NO_OPEN: "0" },
    }),
  );
});

test("browser commands pass a validated URL as one argument without a shell", () => {
  assert.deepEqual(browserCommand(url, "darwin"), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(browserCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
  });
  assert.deepEqual(browserCommand(url, "win32"), {
    command: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url],
  });
  assert.deepEqual(
    browserCommand(
      `https://explorer.altmempool.wtf/?node=${encodeURIComponent(DEVNET.rpc)}`,
      "darwin",
    ),
    {
      command: "open",
      args: [
        `https://explorer.altmempool.wtf/?node=${encodeURIComponent(DEVNET.rpc)}`,
      ],
    },
  );
  for (const unsafe of [
    "javascript:alert(1)",
    "http://explorer.altmempool.wtf/",
    "https://explorer.altmempool.wtf.evil.example/",
    "https://user:password@explorer.altmempool.wtf/",
    "https://explorer.altmempool.wtf/?node=https://evil.example/rpc",
    "https://explorer.altmempool.wtf/?node=&node=",
    "https://explorer.altmempool.wtf/?redirect=https://evil.example",
    "https://explorer.altmempool.wtf/#javascript:alert(1)",
    "https://explorer.altmempool.wtf/tx/--flag",
  ])
    assert.throws(() => browserCommand(unsafe));
});

test("browser errors remain nonfatal, and suppressed or invalid links never launch", async () => {
  const calls: unknown[] = [];
  const launch = async (...args: [string, string[], number]) => {
    calls.push(args);
  };
  assert.deepEqual(
    await openExplorer(url, { ...interactive, launch, platform: "darwin" }),
    { opened: true },
  );
  assert.deepEqual(calls, [["open", [url], 4000]]);
  assert.deepEqual(
    await openExplorer(url, { ...interactive, disabled: true, launch }),
    { opened: false },
  );
  assert.equal(
    (await openExplorer("https://evil.example/", { ...interactive, launch }))
      .opened,
    false,
  );
  assert.equal(calls.length, 1);
  const result = await openExplorer(url, {
    ...interactive,
    launch: async () => {
      throw new Error("sensitive launcher details");
    },
  });
  assert.equal(result.opened, false);
  assert.match(result.warning!, /use the link above/);
  assert(!result.warning!.includes("sensitive"));
});
