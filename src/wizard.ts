import path from "node:path";
import { select, checkbox, confirm, input } from "@inquirer/prompts";
import { FAILURE_MODES, failureLabel } from "./failure-modes.js";
import {
  balanceLabel,
  reductionMetrics,
  transactionResult,
  caseHeading,
  fitChoiceLabel,
  withActivity,
  activity,
} from "./presentation.js";
import { browserEnabled, openExplorer } from "./browser.js";
import { safe, terminal } from "./terminal.js";
import {
  changeDetails,
  transactionPreview,
  changesPreview,
  openPreview,
} from "./preview.js";
import type { EvaluationEvent } from "./reducer.js";
import { FrameShrinkError } from "./shared.js";
import { DEVNET } from "./devnet.js";
import { FAILURE_CATALOG } from "./failures.js";
import {
  listWallets,
  createNamedWallet,
  usingWallet,
  walletStatus,
  fundWallet,
  type NamedWallet,
} from "./wallet.js";
import {
  runDemo,
  demoReference,
  loadDemo,
  resumeDemo,
  defaultDemoDirectory,
  type DemoOptions,
  type DemoRun,
  type SignedCase,
  type DebugStage,
} from "./demo.js";

export type Choice = {
  value: string;
  name: string;
  short?: string;
  disabled?: string;
};
export type WizardUI = {
  choose(
    message: string,
    choices: Choice[],
    options?: { transient?: boolean },
  ): Promise<string>;
  multiple(message: string, choices: Choice[]): Promise<string[]>;
  yes(message: string): Promise<boolean>;
  name(): Promise<string>;
  line(message: string): void;
  busy?<T>(message: string, operation: () => Promise<T>): Promise<T>;
  progress?(message: string | null): void;
  review(message: string): Promise<"open" | "continue">;
};
export function promptUI(color?: boolean): WizardUI {
  const ui = terminal(color);
  let indicator: ReturnType<typeof activity> | undefined;
  const clear = () => {
    indicator?.stop();
    indicator = undefined;
  };
  const progress = (label: string | null) => {
    if (label && indicator) indicator.update(label);
    else {
      clear();
      if (label) indicator = activity(label, { color });
    }
  };
  const theme = {
    spinner: { frames: ["·"], interval: 100 },
    // Inquirer wraps the whole row in highlight/disabled styling. Keep icons
    // plain so the terminal sanitizer never escapes nested ANSI sequences.
    icon: { cursor: "❯", checked: "◉", disabledChecked: "◉" },
    prefix: { idle: ui.cyan("?"), done: ui.green("✓") },
    style: {
      message: ui.bold,
      answer: ui.cyan,
      highlight: ui.cyan,
      error: ui.red,
      help: ui.dim,
      disabled: ui.dim,
      description: ui.dim,
      defaultAnswer: (text: string) => ui.dim("(" + text + ")"),
      key: ui.cyan,
      keysHelpTip: (keys: [string, string][]) =>
        ui.dim(keys.map(([key, action]) => `${key} ${action}`).join(" · ")),
    },
  };
  return {
    progress,
    busy: async (message, operation) => {
      clear();
      return withActivity(message, operation, color);
    },
    choose: (message, choices, options) => {
      clear();
      return select(
        { message, choices, theme, loop: false },
        { clearPromptOnDone: options?.transient },
      );
    },
    multiple: (message, choices) => {
      clear();
      return checkbox({
        message,
        choices: choices.map((choice) => ({
          ...choice,
          name: fitChoiceLabel(
            choice.name,
            choice.disabled,
            process.stdout.columns || 80,
          ),
        })),
        theme,
        required: true,
        pageSize: 7,
        loop: false,
        shortcuts: { all: "a", invert: null },
      });
    },
    review: async (message) => {
      clear();
      const answer = (
        await input(
          {
            message,
            default: "c",
            theme,
            validate: (value) =>
              ["o", "open", "c", "continue"].includes(
                value.trim().toLowerCase(),
              ) || "O opens the editor; C continues",
          },
          { clearPromptOnDone: true },
        )
      )
        .trim()
        .toLowerCase();
      return answer === "o" || answer === "open" ? "open" : "continue";
    },
    yes: (message) => {
      clear();
      return confirm({ message, default: false, theme });
    },
    name: () => {
      clear();
      return input({
        message: "Wallet name",
        theme,
        validate: (value) =>
          (/^[a-z][a-z0-9-]{0,31}$/.test(value) && value !== "default") ||
          "1–32 lowercase letters, digits or hyphens; start with a letter",
      });
    },
    line: (message) => {
      clear();
      console.log(message);
    },
  };
}
export const FAILURE_CHOICES: Choice[] = [
  ...FAILURE_MODES.map((mode) => ({ value: mode.id, name: mode.label })),
  ...FAILURE_CATALOG.filter(
    (f) => !FAILURE_MODES.some((mode) => mode.category === f.id),
  ).map((f) => ({
    value: f.id,
    name: f.id === "budget" ? "Gas budget (local fixture only)" : f.name,
    disabled: "— planned for a future release",
  })),
];
export function casePlan(failures: string[], grouping: string): number[] {
  if (
    !failures.length ||
    new Set(failures).size !== failures.length ||
    failures.some((f) => !FAILURE_MODES.some((mode) => mode.id === f)) ||
    !["combined", "separate"].includes(grouping)
  )
    throw new FrameShrinkError("Invalid failure selection", 2);
  const bits = FAILURE_MODES.filter((mode) => failures.includes(mode.id)).map(
    (mode) => mode.bit,
  );
  return grouping === "combined" ? [bits.reduce((a, b) => a | b, 0)] : bits;
}
export function correctionDiff(
  run: DemoRun,
  stages: DebugStage[],
  color?: boolean,
): string[] {
  const ui = terminal(color);
  return [
    ui.badge("Changes"),
    reductionMetrics(run, color),
    ...changeDetails(stages).map((line) =>
      line.startsWith("−") ? ui.dim(line) : safe(line),
    ),
    ui.dim("Owner authorization retained · edited candidates re-signed"),
    ui.green("Corrected local check passes · signed replay verified"),
  ];
}
export function evaluationLine(
  stage: number,
  failure: string,
  event: EvaluationEvent,
  color?: boolean,
) {
  const ui = terminal(color);
  const edit = event.edit;
  const label =
    edit?.kind === "remove-frames"
      ? `remove frame ${edit.ids.join(", ")}`
      : edit?.kind === "remove-values"
        ? `remove ${edit.count} input value${edit.count === 1 ? "" : "s"} from ${edit.id}`
        : {
            baseline: "original failure",
            repeat: "repeat original",
            control: "corrected check",
            candidate: "candidate",
          }[event.phase];
  const verdict =
    event.phase === "control"
      ? event.status === "accepted"
        ? ui.green("passes")
        : ui.red("control failed")
      : event.phase === "baseline"
        ? event.cause === failure
          ? ui.cyan(failureLabel(failure) + " reproduced")
          : ui.red(event.cause ?? "baseline did not reproduce")
        : event.sameFailure
          ? ui.cyan("same failure")
          : ui.dim(
              "discarded · " +
                (event.cause
                  ? failureLabel(event.cause)
                  : "failure no longer reproduced"),
            );
  return `${ui.dim(`[${stage}.${event.evaluation}]`)} ${label} · ${verdict} · ${event.bytes} bytes`;
}
export type WizardServices = {
  wallets: typeof listWallets;
  create: typeof createNamedWallet;
  status: () => Promise<{
    balanceWei: string | null;
    balanceEth: string | null;
  }>;
  fund: typeof fundWallet;
  run: typeof runDemo;
  load: typeof loadDemo;
  resume: typeof resumeDemo;
  directory: typeof defaultDemoDirectory;
  openEditor?: typeof openPreview;
  openBrowser?: (url: string) => Promise<void>;
};
const defaults: WizardServices = {
  wallets: listWallets,
  create: createNamedWallet,
  status: walletStatus,
  fund: fundWallet,
  run: runDemo,
  load: loadDemo,
  resume: resumeDemo,
  directory: defaultDemoDirectory,
  openEditor: openPreview,
  openBrowser: async (url) => {
    const result = await openExplorer(url);
    if (result.warning) throw new Error(result.warning);
  },
};

export async function startTransaction(
  prompts: WizardUI = promptUI(),
  services: WizardServices = defaults,
  options: {
    color?: boolean;
    directory?: string;
    resume?: string;
    openLinks?: boolean;
    verbose?: boolean;
  } = {},
): Promise<DemoRun[]> {
  const ui = terminal(options.color),
    print = prompts.line;
  const openLinks = options.openLinks ?? browserEnabled();
  const opened = new Set<string>();
  const openLink = async (url: string) => {
    if (!openLinks || opened.has(url)) return;
    opened.add(url);
    try {
      await (services.openBrowser ?? defaults.openBrowser!)(url);
    } catch {
      print(ui.warn("Browser unavailable · use the link above"));
    }
  };
  print(ui.badge("FrameShrink") + ui.dim(" · devnet 1337"));
  const saved = options.resume
    ? await services.load(options.resume)
    : undefined;
  const review = async (
    label: string,
    content: () => string,
    kind: "transaction" | "changes",
  ) => {
    while ((await prompts.review(label)) === "open") {
      try {
        await (services.openEditor ?? openPreview)(content(), kind);
      } catch (e) {
        if (["ExitPromptError", "AbortPromptError"].includes((e as Error).name))
          throw e;
        print(ui.warn((e as Error).message));
      }
    }
  };
  const wallets = await services.wallets();
  let wallet: NamedWallet;
  if (saved) {
    const found = wallets.find((w) => w.address === saved.wallet);
    if (!found)
      throw new FrameShrinkError("Case wallet is unavailable in this CLI", 3);
    wallet = found;
  } else {
    const choice = await prompts.choose("Wallet", [
      ...wallets.map((w) => ({
        value: w.directory,
        name: `${w.name} · ${w.address}`,
        short: w.name,
      })),
      { value: "new", name: "Create wallet" },
    ]);
    if (choice === "new") {
      let name: string;
      do {
        name = await prompts.name();
        if (wallets.some((existing) => existing.name === name))
          print(
            ui.warn("Wallet name already exists · choose a different name"),
          );
      } while (wallets.some((existing) => existing.name === name));
      wallet = await services.create(name);
    } else {
      const found = wallets.find((w) => w.directory === choice);
      if (!found) throw new FrameShrinkError("Unknown wallet selection", 2);
      wallet = found;
    }
  }
  const busy = <T>(label: string, operation: () => Promise<T>) =>
    prompts.busy ? prompts.busy(label, operation) : operation();
  return usingWallet(wallet.directory, async () => {
    print(ui.cyan(wallet.address));
    if (!saved) {
      let status = await busy("Checking wallet balance", () =>
        services.status(),
      );
      print(ui.dim(balanceLabel(status.balanceEth)));
      // A failed RPC read is not evidence of an empty wallet.
      while (
        status.balanceWei === null ||
        BigInt(status.balanceWei) < 60000000000000000n
      ) {
        if (status.balanceWei === null) {
          const action = await prompts.choose(
            "Balance unavailable",
            [
              { value: "retry", name: "Retry balance check" },
              { value: "cancel", name: "Exit" },
            ],
            { transient: true },
          );
          if (action !== "retry") return [];
          status = await busy("Checking wallet balance", () =>
            services.status(),
          );
          if (status.balanceWei !== null)
            print(ui.dim(balanceLabel(status.balanceEth)));
          continue;
        }
        const action = await prompts.choose(
          "Fund wallet",
          [
            { value: "faucet", name: "Request faucet" },
            {
              value: "address",
              name: openLinks ? "Open faucet in browser" : "Show faucet link",
            },
            { value: "check", name: "Recheck balance" },
            { value: "cancel", name: "Exit" },
          ],
          { transient: true },
        );
        if (action === "cancel") return [];
        if (action === "address") {
          const url = `https://explorer.altmempool.wtf/?node=${encodeURIComponent(DEVNET.rpc)}`;
          print(ui.cyan(url));
          await openLink(url);
        } else if (action === "faucet") {
          const funding = await busy("Confirming faucet funding", () =>
            services.fund(),
          );
          print(
            funding.fundingConfirmed
              ? ui.ok("Faucet confirmed")
              : ui.warn("Faucet " + funding.faucet.state),
          );
          if (funding.faucet.txHash) print(ui.dim(funding.faucet.txHash));
          if (funding.faucet.error) print(ui.warn(funding.faucet.error));
        }
        const previousBalance = status.balanceWei;
        status = await busy("Checking wallet balance", () => services.status());
        if (status.balanceWei !== previousBalance)
          print(ui.dim(balanceLabel(status.balanceEth)));
      }
    }
    const selected = saved
      ? undefined
      : await prompts.multiple("Failures · space to select", FAILURE_CHOICES);
    const grouping = saved
      ? undefined
      : await prompts.choose("Transactions", [
          { value: "combined", name: "One combined transaction" },
          { value: "separate", name: "Separate transactions" },
        ]);
    const plan = saved ? [undefined] : casePlan(selected!, grouping!);
    const runs: DemoRun[] = [];
    const base = options.directory ?? services.directory();
    for (const [index, mask] of plan.entries()) {
      if (mask) print(caseHeading(mask, index + 1, plan.length, options.color));
      const directory =
        options.resume ??
        (plan.length > 1 ? path.join(base, `case-${index + 1}`) : base);
      const hooks: DemoOptions = {
        onActivity: (label) => prompts.progress?.(label),
        opcodeMask: mask && mask <= 3 ? (mask as 1 | 2 | 3) : undefined,
        failureMask: mask && mask > 3 ? mask : undefined,
        resume: !!saved,
        beforeDeploy: async () => {
          print(
            ui.dim(
              "Test validator · verifies your signature and triggers selected failures",
            ),
          );
          print(
            ui.dim(
              "Setup cost · 0.01 devnet ETH funding + deployment gas ≤ 0.05 ETH",
            ),
          );
          return prompts.yes("Deploy test validator?");
        },
        beforeOriginal: async (original: SignedCase, context) => {
          print(
            ui.dim(
              `${original.frameIds.length} frames · ${(original.raw.length - 2) / 2} bytes · 0 ETH call value · gas on execution`,
            ),
          );
          await review(
            "Preview transaction · O open / C continue",
            () => transactionPreview(original, context),
            "transaction",
          );
          return prompts.yes("Submit failing transaction to devnet?");
        },
        onOriginalRejected: (run) => {
          print(`${ui.dim("Original hash")} ${ui.cyan(run.originalHash)}`);
          print(
            ui.cyan(
              `https://explorer.altmempool.wtf/tx/${run.originalHash}?node=${encodeURIComponent(DEVNET.primary)}`,
            ),
          );
        },
        onEvaluation: (stage, failure, event) => {
          if (options.verbose)
            print(evaluationLine(stage, failure, event, options.color));
          else prompts.progress?.(evaluationLine(stage, failure, event, false));
        },
        beforeDebug: async () => {
          print(
            ui.dim(
              "Each local check simulates a signed candidate and applies policy",
            ),
          );
          const action = await prompts.choose("Debug", [
            {
              value: "standard",
              name: "Start · up to 80 local checks per failure",
            },
            {
              value: "quick",
              name: "Quick · up to 20 local checks per failure",
            },
            { value: "later", name: "Save & exit" },
          ]);
          return action === "later"
            ? false
            : {
                maxEvaluations: action === "quick" ? 20 : 80,
                maxDurationMs: 120000,
              };
        },
        beforeCorrected: async (run, _corrected, stages, context) => {
          for (const line of correctionDiff(run, stages, options.color))
            print(line);
          await review(
            "Review changes · O open / C continue",
            () => changesPreview(stages, context),
            "changes",
          );
          return prompts.yes("Submit corrected transaction to devnet?");
        },
      };
      let run: DemoRun;
      try {
        run = await services.run(
          directory,
          (message) => print(ui.ok(message)),
          hooks,
        );
      } catch (e) {
        if (e instanceof FrameShrinkError && e.exitCode === 0) {
          print(ui.dim("Cancelled"));
          break;
        }
        throw e;
      } finally {
        prompts.progress?.(null);
      }
      const resultLink = () =>
        run.explorer ??
        `https://explorer.altmempool.wtf/tx/${run.correctedHash}?node=${encodeURIComponent(DEVNET.primary)}`;
      if (run.state === "pending" && run.correctedHash) {
        print(transactionResult(run, options.color));
        print(ui.cyan(resultLink()));
      }
      while (run.state === "pending") {
        const next = await prompts.choose(
          "Receipt pending",
          [
            { value: "check", name: "Check again" },
            { value: "exit", name: "Save & exit" },
          ],
          { transient: true },
        );
        if (next !== "check") break;
        run = await busy("Checking public receipt", () =>
          services.resume(directory),
        );
      }
      if (run.error && run.state === "inconclusive") print(ui.warn(run.error));
      runs.push(run);
      if (run.correctedHash) {
        if (run.state !== "pending") {
          print(transactionResult(run, options.color));
          print(ui.cyan(resultLink()));
        }
        if (run.state === "complete") await openLink(resultLink());
      }
      if (run.state === "rejected" || run.state === "reduced") {
        print(
          ui.dim(
            `Continue: frameshrink start debug ${demoReference(run.directory)}`,
          ),
        );
        break;
      }
      if (run.state !== "complete") {
        if (run.state === "pending")
          print(
            ui.warn(
              `Pending · frameshrink demo resume ${demoReference(run.directory)}`,
            ),
          );
        else
          print(
            ui.dim(
              run.state === "preparing"
                ? "Not submitted"
                : "Saved · no further submission",
            ),
          );
        break;
      }
    }
    return runs;
  });
}
