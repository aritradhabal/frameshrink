import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startTransaction,
  type WizardServices,
  type WizardUI,
} from "../src/wizard.js";
import type { DemoRun, SignedCase } from "../src/demo.js";
import type { NamedWallet } from "../src/wallet.js";

const wallet: NamedWallet = {
  schemaVersion: 1,
  name: "demo",
  directory: "/unused-flow-test-wallet",
  address: "0x" + "12".repeat(20),
  chainId: 1337,
  network: "devnet",
  createdAt: "2026-11-07T00:00:00.000Z",
  custody: "local development key; mode 0600",
  scope: "sponsor devnet only; no website authentication",
};
const correctedHash = "0x" + "ab".repeat(32);
const explorer = `https://explorer.altmempool.wtf/tx/${correctedHash}?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc`;

function prompts(lines: string[] = []): WizardUI {
  return {
    choose: async (message) =>
      message === "Wallet"
        ? wallet.directory
        : message === "Transactions"
          ? "combined"
          : "check",
    multiple: async () => ["timestamp"],
    yes: async () => false,
    review: async () => "continue",
    name: async () => {
      throw Error("Unexpected wallet creation");
    },
    line: (line) => lines.push(line),
  };
}

function services(overrides: Partial<WizardServices>): WizardServices {
  return {
    wallets: async () => [wallet],
    status: async () => ({
      balanceWei: "1000000000000000000",
      balanceEth: "1",
    }),
    directory: () => "/flow-test-case",
    create: async () => {
      throw Error("Unexpected wallet creation");
    },
    fund: async () => {
      throw Error("Unexpected faucet request");
    },
    run: async () => {
      throw Error("Unexpected transaction run");
    },
    load: async () => {
      throw Error("Unexpected saved-case load");
    },
    resume: async () => {
      throw Error("Unexpected receipt check");
    },
    ...overrides,
  };
}

test("unavailable wallet balance offers retry or exit without requesting faucet funds", async () => {
  for (const retryFirst of [false, true]) {
    let checks = 0;
    const choices: string[] = [];
    const ui = prompts();
    ui.choose = async (message, options) => {
      if (message === "Wallet") return wallet.directory;
      assert.equal(message, "Balance unavailable");
      assert.deepEqual(
        options.map((option) => option.value),
        ["retry", "cancel"],
      );
      choices.push(message);
      return retryFirst && choices.length === 1 ? "retry" : "cancel";
    };
    ui.multiple = async () => {
      throw Error("Failure picker must wait for a known balance");
    };
    const result = await startTransaction(
      ui,
      services({
        status: async () => {
          checks++;
          return { balanceWei: null, balanceEth: null };
        },
      }),
      { color: false },
    );
    assert.deepEqual(result, []);
    assert.equal(checks, retryFirst ? 2 : 1);
    assert.equal(choices.length, checks);
  }
});

test("repeated pending receipt checks reconcile one submission and open its confirmed result once", async () => {
  let submissions = 0,
    checks = 0;
  const opened: string[] = [];
  const run = {
    state: "pending",
    directory: "/flow-test-case",
    correctedHash,
    explorer,
  } as DemoRun;
  const result = await startTransaction(
    prompts(),
    services({
      run: async () => {
        submissions++;
        return run;
      },
      resume: async (directory) => {
        assert.equal(directory, run.directory);
        checks++;
        return {
          ...run,
          state: checks < 3 ? "pending" : "complete",
          ...(checks < 3 ? {} : { blockNumber: "0x1" }),
        };
      },
      openBrowser: async (url) => {
        opened.push(url);
      },
    }),
    { color: false, openLinks: true },
  );
  assert.equal(submissions, 1);
  assert.equal(checks, 3);
  assert.equal(result[0].state, "complete");
  assert.deepEqual(opened, [explorer]);
});

test("declining the original submission says not submitted and never opens a browser", async () => {
  const lines: string[] = [];
  const result = await startTransaction(
    prompts(lines),
    services({
      run: async (directory, _progress, hooks) => {
        assert.equal(
          await hooks!.beforeOriginal!(
            {
              frameIds: ["verify", "call"],
              raw: "0x0601",
            } as unknown as SignedCase,
            {} as never,
          ),
          false,
        );
        return { state: "preparing", directory } as DemoRun;
      },
      openBrowser: async () => {
        throw Error("An unsubmitted case has no browser result");
      },
    }),
    { color: false, openLinks: true },
  );
  assert.equal(result[0].state, "preparing");
  assert(lines.some((line) => line.includes("Not submitted")));
  assert(!lines.some((line) => line.includes("Saved")));
});

test("browser opt-out and unconfirmed outcomes never open explorer tabs", async () => {
  for (const [state, openLinks] of [
    ["complete", false],
    ["pending", true],
    ["inconclusive", true],
  ] as const) {
    const ui = prompts();
    ui.choose = async (message) =>
      message === "Wallet"
        ? wallet.directory
        : message === "Transactions"
          ? "combined"
          : "exit";
    const result = await startTransaction(
      ui,
      services({
        run: async (directory) =>
          ({ state, correctedHash, explorer, directory }) as DemoRun,
        openBrowser: async () => {
          throw Error("Browser must remain closed");
        },
      }),
      { color: false, openLinks },
    );
    assert.equal(result[0].state, state);
  }
});

test("browser launch failure preserves the confirmed transaction and printed explorer URL", async () => {
  const lines: string[] = [];
  let attempts = 0;
  const result = await startTransaction(
    prompts(lines),
    services({
      run: async (directory) =>
        ({ state: "complete", correctedHash, explorer, directory }) as DemoRun,
      openBrowser: async () => {
        attempts++;
        throw Error("No browser is configured");
      },
    }),
    { color: false, openLinks: true },
  );
  assert.equal(attempts, 1);
  assert.equal(result[0].state, "complete");
  assert(lines.some((line) => line.includes(correctedHash)));
  assert(lines.some((line) => line.includes(explorer)));
});

test("many local checks keep default output bounded while verbose retains every check", async () => {
  for (const verbose of [false, true]) {
    const lines: string[] = [],
      progress: Array<string | null> = [],
      order: string[] = [];
    const ui = prompts(lines);
    ui.progress = (message) => {
      progress.push(message);
      order.push(message === null ? "clear-progress" : "progress");
    };
    ui.line = (message) => {
      lines.push(message);
      order.push(message.includes(correctedHash) ? "final-result" : "line");
    };
    await startTransaction(
      ui,
      services({
        run: async (directory, _onProgress, hooks) => {
          for (let check = 0; check < 105; check++) {
            hooks!.onEvaluation!(
              Math.floor(check / 40) + 1,
              "BANNED_OPCODE:TIMESTAMP",
              {
                evaluation: (check % 40) + 1,
                phase: "candidate",
                edit: { kind: "remove-frames", ids: ["optional"] },
                status: "rejected",
                bytes: 700 - check,
                sameFailure: true,
                cause: "BANNED_OPCODE:TIMESTAMP",
              },
            );
          }
          return {
            state: "complete",
            directory,
            correctedHash,
            explorer,
          } as DemoRun;
        },
      }),
      { color: false, openLinks: false, verbose },
    );
    const checkLines = lines.filter((line) => line.includes("remove frame"));
    if (verbose) {
      assert.equal(checkLines.length, 105);
      assert.equal(progress.filter((message) => message !== null).length, 0);
    } else {
      assert.equal(checkLines.length, 0);
      assert(
        lines.length < 20,
        "Repeated checks must not accumulate in scrollback",
      );
      assert.equal(progress.filter((message) => message !== null).length, 105);
      assert(progress.every((message) => !message?.includes("\x1b")));
    }
    const final = order.indexOf("final-result");
    assert(final >= 0);
    assert.equal(order[final - 1], "clear-progress");
    assert.equal(progress.at(-1), null);
  }
});
