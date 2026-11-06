import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  casePlan,
  FAILURE_CHOICES,
  startTransaction,
  type WizardUI,
  type WizardServices,
} from "../src/wizard.js";
import {
  createNamedWallet,
  createWallet,
  listWallets,
  usingWallet,
  walletStatus,
} from "../src/wallet.js";
import {
  runDemo,
  demoReference,
  resolveDemoDirectory,
  type DemoRun,
  type SignedCase,
  type DebugStage,
} from "../src/demo.js";

test("wallet picker preserves legacy wallets, named identities and async selection isolation", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "frameshrink-picker-"));
  try {
    const legacy = await createWallet(path.join(base, "wallet"));
    const a = await createNamedWallet("alice", base),
      b = await createNamedWallet("bob", base);
    const wallets = await listWallets(base);
    assert.deepEqual(
      wallets.map((w) => w.name),
      ["default", "alice", "bob"],
    );
    assert.equal(wallets[0].address, legacy.address);
    assert.equal((await createNamedWallet("alice", base)).address, a.address);
    await assert.rejects(() => createNamedWallet("../escape", base));
    const addresses = await Promise.all(
      [a, b].map((w) =>
        usingWallet(w.directory, async () => {
          await new Promise((r) => setImmediate(r));
          return (await walletStatus({ offline: true })).address;
        }),
      ),
    );
    assert.deepEqual(addresses, [a.address, b.address]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("failure planner includes all selections and refuses disabled or duplicate entries", () => {
  assert.deepEqual(casePlan(["number", "timestamp"], "combined"), [3]);
  assert.deepEqual(casePlan(["number", "timestamp"], "separate"), [1, 2]);
  assert.equal(FAILURE_CHOICES.filter((c) => !c.disabled).length, 5);
  for (const values of [[], ["signature"], ["timestamp", "timestamp"]])
    assert.throws(() => casePlan(values, "combined"));
});

for (const grouping of ["combined", "separate"]) {
  test(`wizard ${grouping}: explicit confirmations gate original and final submissions`, async () => {
    for (const decline of ["original", "debug", "corrected", "none"]) {
      const events: string[] = [];
      const wallet = {
        name: "test",
        directory: "/unused",
        address: "0x" + "11".repeat(20),
      } as Awaited<ReturnType<typeof createNamedWallet>>;
      const ui: WizardUI = {
        choose: async (message) =>
          message === "Wallet"
            ? wallet.directory
            : message === "Transactions"
              ? grouping
              : decline === "debug"
                ? "later"
                : "standard",
        multiple: async () => ["timestamp", "number"],
        yes: async (message) => {
          events.push(message);
          return (
            !(decline === "original" && message.startsWith("Submit failing")) &&
            !(decline === "corrected" && message.startsWith("Submit corrected"))
          );
        },
        name: async () => {
          throw Error("Unexpected creation");
        },
        line: () => {},
        review: async () => "continue",
      };
      const services = {
        wallets: async () => [wallet],
        status: async () => ({
          balanceWei: "1000000000000000000",
          balanceEth: "1",
        }),
        directory: () => "/cases/test",
        run: async (directory, _progress, hooks) => {
          const run = {
            state: "preparing",
            originalFrames: 4,
            reducedFrames: 2,
            originalBytes: 700,
            reducedBytes: 280,
            directory,
          } as DemoRun;
          events.push("mask:" + hooks!.opcodeMask);
          if (
            !(await hooks!.beforeOriginal!(
              {
                frameIds: ["a", "b"],
                raw: "0x0601",
                hash: "0x123",
              } as unknown as SignedCase,
              {} as never,
            ))
          )
            return run;
          events.push("original sent");
          run.state = "rejected";
          if (!(await hooks!.beforeDebug!(run))) return run;
          events.push("debugged");
          run.state = "reduced";
          const stages = [
            {
              failure: "BANNED_OPCODE:TIMESTAMP",
              original: {
                recipe: { body: [], family: "banned-opcode", opcodeMask: 1 },
              },
              correction: { recipe: { body: [], family: "verify-gas" } },
            } as unknown as DebugStage,
          ] as DebugStage[];
          if (
            !(await hooks!.beforeCorrected!(
              run,
              {} as unknown as SignedCase,
              stages,
              {} as never,
            ))
          )
            return run;
          events.push("correction sent");
          run.state = "complete";
          return run;
        },
      } as WizardServices;
      const results = await startTransaction(ui, services, { color: false });
      const count = decline === "none" && grouping === "separate" ? 2 : 1;
      assert.equal(results.length, count);
      assert.equal(
        events.filter((e) => e === "original sent").length,
        decline === "original" ? 0 : count,
      );
      assert.equal(
        events.filter((e) => e === "debugged").length,
        ["original", "debug"].includes(decline) ? 0 : count,
      );
      assert.equal(
        events.filter((e) => e === "correction sent").length,
        decline === "none" ? count : 0,
      );
      assert.deepEqual(
        events.filter((e) => e.startsWith("mask:")),
        grouping === "combined"
          ? ["mask:3"]
          : count === 2
            ? ["mask:1", "mask:2"]
            : ["mask:1"],
      );
    }
  });
}

test("new-wallet funding can exit without starting a transaction or requesting a faucet", async () => {
  const events: string[] = [];
  const prompts: WizardUI = {
    choose: async (message) => (message === "Wallet" ? "new" : "cancel"),
    name: async () => "demo",
    multiple: async () => {
      throw Error("Unexpected failure picker");
    },
    yes: async () => {
      throw Error("Unexpected submission");
    },
    line: () => {},
    review: async () => "continue",
  };
  const wallet = {
    directory: "/unused",
    address: "0x" + "22".repeat(20),
  } as Awaited<ReturnType<typeof createNamedWallet>>;
  const services = {
    wallets: async () => [],
    create: async (name: string) => {
      events.push("created:" + name);
      return wallet;
    },
    status: async () => ({ balanceWei: "0", balanceEth: "0" }),
    fund: async () => {
      throw Error("Unexpected faucet write");
    },
    run: async () => {
      throw Error("Unexpected transaction");
    },
  } as unknown as WizardServices;
  assert.deepEqual(
    await startTransaction(prompts, services, { color: false }),
    [],
  );
  assert.deepEqual(events, ["created:demo"]);
});

test("saved debug cases select their original CLI identity without a new failure picker", async () => {
  const wallet = {
    directory: "/unused",
    address: "0x" + "22".repeat(20),
  } as Awaited<ReturnType<typeof createNamedWallet>>;
  const run = {
    wallet: wallet.address,
    state: "reduced",
    directory: "/case",
  } as DemoRun;
  let resumed = false;
  const prompts: WizardUI = {
    choose: async () => {
      throw Error("Unexpected picker");
    },
    name: async () => {
      throw Error("Unexpected wallet");
    },
    multiple: async () => {
      throw Error("Unexpected selection");
    },
    yes: async () => false,
    line: () => {},
    review: async () => "continue",
  };
  const services = {
    wallets: async () => [wallet],
    load: async () => run,
    create: async () => {
      throw Error("Unexpected wallet creation");
    },
    status: async () => {
      throw Error("Unexpected network read");
    },
    fund: async () => {
      throw Error("Unexpected faucet write");
    },
    resume: async () => {
      throw Error("Unexpected pending resume");
    },
    directory: () => "/unused",
    run: async (directory, _progress, options) => {
      assert.equal(directory, "/case");
      assert.equal(options?.resume, true);
      resumed = true;
      return run;
    },
  } as WizardServices;
  await startTransaction(prompts, services, { resume: "/case", color: false });
  assert(resumed);
  await assert.rejects(
    () =>
      startTransaction(
        prompts,
        { ...services, wallets: async () => [] },
        { resume: "/case" },
      ),
    /wallet is unavailable/,
  );
});

test("pending correction reconciliation reads the same case without sending another transaction", async () => {
  const wallet = {
    directory: "/unused",
    address: "0x" + "22".repeat(20),
  } as Awaited<ReturnType<typeof createNamedWallet>>;
  let sends = 0,
    checks = 0;
  const prompts: WizardUI = {
    choose: async (message) =>
      message === "Wallet"
        ? wallet.directory
        : message === "Transactions"
          ? "separate"
          : "check",
    name: async () => "unused",
    multiple: async () => ["timestamp", "number"],
    yes: async () => true,
    line: () => {},
    review: async () => "continue",
  };
  const services = {
    wallets: async () => [wallet],
    status: async () => ({
      balanceWei: "1000000000000000000",
      balanceEth: "1",
    }),
    directory: () => "/case",
    create: async () => {
      throw Error("Unexpected creation");
    },
    fund: async () => {
      throw Error("Unexpected funding");
    },
    load: async () => {
      throw Error("Unexpected loading");
    },
    run: async (directory) => {
      sends++;
      return { state: "pending", directory } as DemoRun;
    },
    resume: async (directory: string) => {
      assert.match(directory, /^\/case\/case-[12]$/);
      checks++;
      return { state: "complete", blockNumber: "0x1", directory } as DemoRun;
    },
  } as WizardServices;
  const result = await startTransaction(prompts, services, { color: false });
  assert.equal(result[0].state, "complete");
  assert.equal(sends, 2);
  assert.equal(checks, 2);
});

test("existing output directories stop before wallet access or any deployment approval", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "frameshrink-existing-"));
  let approvals = 0;
  try {
    await assert.rejects(
      () =>
        runDemo(directory, undefined, {
          beforeDeploy: async () => {
            approvals++;
            return true;
          },
        }),
      /directory already exists/,
    );
    assert.equal(approvals, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editor reviews and original evidence precede debug; final output contains only the corrected transaction", async () => {
  const { readJSON, ROOT } = await import("../src/shared.js");
  const dir = ROOT + "evidence/wizard-combined/";
  const original = await readJSON(dir + "original.json");
  const context = await readJSON(dir + "context.json");
  const stages = await readJSON(dir + "debug-stages.json");
  const run: DemoRun = await readJSON(dir + "run.json");
  const lines: string[] = [],
    opened: string[] = [],
    reviews = new Set<string>();
  const wallet = {
    name: "demo",
    address: context.address,
    directory: "/unused",
  } as Awaited<ReturnType<typeof createNamedWallet>>;
  const prompts: WizardUI = {
    choose: async (message) => {
      lines.push("prompt:" + message);
      return message === "Wallet"
        ? wallet.directory
        : message === "Transactions"
          ? "combined"
          : "standard";
    },
    name: async () => "unused",
    multiple: async () => ["timestamp", "number"],
    yes: async () => true,
    review: async (message) => {
      if (reviews.has(message)) return "continue";
      reviews.add(message);
      return "open";
    },
    line: (message) => lines.push(message),
  };
  const services = {
    wallets: async () => [wallet],
    status: async () => ({
      balanceWei: "1000000000000000000",
      balanceEth: "1",
    }),
    directory: () => "/unused",
    openEditor: async (content, kind) => {
      opened.push(kind);
      assert(content.includes("View-only"));
      assert(content.includes(original.raw));
      return "/unused";
    },
    run: async (_directory, _progress, hooks) => {
      assert(await hooks!.beforeOriginal!(original, context));
      hooks!.onOriginalRejected!(run);
      assert(await hooks!.beforeDebug!(run));
      assert(
        await hooks!.beforeCorrected!(
          run,
          stages.at(-1).correction,
          stages,
          context,
        ),
      );
      return run;
    },
  } as WizardServices;
  await startTransaction(prompts, services, { color: false });
  assert.deepEqual(opened, ["transaction", "changes"]);
  const firstHash = lines.findIndex((line) => line.includes(original.hash));
  const debug = lines.indexOf("prompt:Debug");
  assert(firstHash >= 0 && firstHash < debug);
  assert.equal(lines.filter((line) => line.includes(original.hash)).length, 2); // immediate hash and explorer link only
  assert(!lines.slice(debug).some((line) => line.includes(original.hash)));
  assert(
    lines
      .slice(debug)
      .some(
        (line) =>
          line.includes("CONFIRMED") && line.includes(run.correctedHash!),
      ),
  );
  assert(lines.at(-1)!.includes(run.correctedHash!));
  assert(!lines.some((line) => line === run.directory));
});

test("recovery uses short case IDs while existing and custom paths still resolve", async () => {
  const { DATA_DIRECTORY, ROOT } = await import("../src/shared.js");
  const directory = path.join(DATA_DIRECTORY, "demos", "saved-case", "case-1");
  assert.equal(demoReference(directory), "saved-case/case-1");
  assert.equal(resolveDemoDirectory(demoReference(directory)), directory);
  assert.equal(
    resolveDemoDirectory("evidence/unified-demo"),
    path.join(ROOT, "evidence/unified-demo"),
  );
  const custom = path.join(tmpdir(), "frameshrink-custom-case");
  assert.equal(resolveDemoDirectory(demoReference(custom)), custom);
});

test("new wallet selection cannot silently reuse an existing wallet name", async () => {
  const existing = {
    name: "demo",
    directory: "/unused",
    address: "0x" + "22".repeat(20),
  } as Awaited<ReturnType<typeof createNamedWallet>>;
  const names = ["demo", "fresh"],
    created: string[] = [],
    lines: string[] = [];
  const prompts: WizardUI = {
    choose: async (message) => (message === "Wallet" ? "new" : "cancel"),
    name: async () => names.shift()!,
    multiple: async () => [],
    yes: async () => false,
    review: async () => "continue",
    line: (value) => lines.push(value),
  };
  const services = {
    wallets: async () => [existing],
    status: async () => ({ balanceWei: "0", balanceEth: "0" }),
    create: async (name: string) => {
      created.push(name);
      return { ...existing, name };
    },
  } as WizardServices;
  await startTransaction(prompts, services, { color: false });
  assert.deepEqual(created, ["fresh"]);
  assert(lines.some((line) => line.includes("already exists")));
});
