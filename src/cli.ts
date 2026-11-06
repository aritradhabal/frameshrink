import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, json, readJSON, FrameShrinkError, hash } from "./shared.js";
import { capture, evaluate } from "./runtime.js";
import { parseRecipe } from "./recipe.js";
import { reduce } from "./reducer.js";
import { exportBundle, replay, verifyBundle } from "./bundle.js";
import { inspectImported } from "./imported.js";
import { exclusive } from "./lock.js";
import {
  parseExplorerLink,
  investigate,
  exportInvestigation,
  loadInvestigation,
  formatInvestigation,
  defaultCaseDirectory,
  type Investigation,
} from "./investigation.js";
import {
  createWallet,
  walletStatus,
  fundWallet,
  type WalletIdentity,
  type FaucetRecord,
} from "./wallet.js";
import { failuresReport, FAILURE_CATALOG } from "./failures.js";
import {
  runDemo,
  demoReference,
  resolveDemoDirectory,
  loadDemo,
  resumeDemo,
  replayDemo,
  defaultDemoDirectory,
  type DemoRun,
} from "./demo.js";
import {
  activity,
  replayLine,
  reductionMetrics,
  transactionResult,
} from "./presentation.js";
import { prepareRuntime } from "./environment.js";
import { terminal, safe } from "./terminal.js";
import { browserEnabled } from "./browser.js";
const input = process.argv.slice(2),
  machine = input.includes("--json"),
  verbose = input.includes("--verbose");
const ui = terminal(input.includes("--no-color") ? false : undefined);
const [command, arg, ...rest] = input.filter(
  (v) => !["--json", "--verbose", "--no-color", "--no-open"].includes(v),
);
const help = [
  ui.badge("FrameShrink") + "  Ethereum frame transaction debugger",
  "",
  "  demo local                 Try the five-stage replay · Docker, no funds",
  "  start transaction          Run the interactive devnet workflow",
  "  debug <explorer-url>        Investigate a public rejection",
  "",
  "  wallet create | status [--offline] | faucet",
  "  start debug <case>          Continue a saved case",
  "  demo <status|resume> <case>  Check a saved public submission",
  "  runtime up | down          Manage the local fixture runtime",
  "  reduce <recipe> --out <dir> Minimize a local fixture",
  "  replay <dir>               Verify a saved reproduction",
  "",
  "  inspect <file> · explain <case> · compare <a> <b>",
  "  whoami · doctor · failures · serve",
  ui.dim(
    "  --json · --no-color · --no-open · --verbose (every local check) · --version",
  ),
].join("\n");
function failUsage(): never {
  throw new FrameShrinkError("Invalid arguments. Use frameshrink --help.", 2);
}
function out(value: unknown, lines: string[]) {
  console.log(machine ? json(value) : lines.join("\n"));
}
function outOption(args: string[]) {
  if (!args.length) return undefined;
  if (
    args.length !== 2 ||
    args[0] !== "--out" ||
    !args[1] ||
    args[1].startsWith("--")
  )
    failUsage();
  return path.resolve(args[1]);
}
function walletLines(
  result: WalletIdentity & {
    created?: boolean;
    balanceEth?: string | null;
    faucet?: FaucetRecord | null;
    fundingConfirmed?: boolean;
  },
) {
  return [
    `${ui.dim("Wallet")} ${ui.cyan(result.address)}${result.created ? " · created" : ""}`,
    `${ui.dim("Chain")}  ${result.chainId}${result.balanceEth !== undefined && result.balanceEth !== null ? " · " + safe(result.balanceEth) + " ETH" : ""}`,
    ...(result.fundingConfirmed !== undefined
      ? [
          result.fundingConfirmed
            ? ui.ok("Faucet confirmed")
            : ui.warn("Faucet " + result.faucet?.state),
          ...(result.faucet?.txHash ? [ui.dim(result.faucet.txHash)] : []),
          ...(result.faucet?.error ? [ui.warn(result.faucet.error)] : []),
        ]
      : []),
  ];
}
function investigationLines(report: Investigation, directory: string) {
  if (verbose) return [formatInvestigation(report, directory)];
  const first = report.failures[0];
  return [
    ui.cyan(report.source.hash),
    first
      ? ui.warn(
          `${first.rule}${first.frameIndex !== null ? " · frame " + first.frameIndex : ""}`,
        )
      : ui.warn(report.outcome),
    safe(
      first?.decodedError?.message ??
        first?.detail ??
        report.interpretation.observed,
    ),
    ui.warn(
      `Replay unavailable · ${report.reproducibility.missing.length} missing artifacts`,
    ),
    ui.dim(directory),
  ];
}
function demoLines(run: DemoRun) {
  return [
    run.correctedHash
      ? transactionResult(run, input.includes("--no-color") ? false : undefined)
      : ui.warn(run.state),
    ...(run.originalBytes !== undefined
      ? [
          `${run.originalFrames} → ${run.reducedFrames} frames · ${run.originalBytes} → ${run.reducedBytes} bytes`,
        ]
      : []),
    ...(run.blockNumber
      ? [ui.ok("Public success · block " + BigInt(run.blockNumber).toString())]
      : []),
    ...(run.error ? [ui.warn(run.error)] : []),
    ...(run.explorer ? [ui.cyan(run.explorer)] : []),
  ];
}
try {
  for (const flag of ["--json", "--verbose", "--no-color", "--no-open"])
    if (input.filter((v) => v === flag).length > 1) failUsage();
  if (command === "--version" || command === "-v") {
    if (arg || rest.length) failUsage();
    const pkg = await readJSON(ROOT + "package.json");
    console.log(
      machine ? json({ name: pkg.name, version: pkg.version }) : pkg.version,
    );
  } else if (!command || command === "help" || command === "--help") {
    if (arg || rest.length) failUsage();
    if (machine)
      console.log(
        json({
          schemaVersion: 1,
          commands: [
            "start",
            "wallet",
            "demo",
            "runtime",
            "debug",
            "reduce",
            "replay",
            "explain",
            "inspect",
            "compare",
            "whoami",
            "doctor",
            "failures",
            "serve",
          ],
        }),
      );
    else console.log(help);
  } else if (command === "start") {
    if (machine)
      throw new FrameShrinkError(
        "Interactive wizard requires a terminal; omit --json",
        2,
      );
    if (
      !process.stdin.isTTY ||
      !process.stdout.isTTY ||
      process.env.TERM === "dumb"
    )
      throw new FrameShrinkError(
        "Run frameshrink start in an interactive terminal",
        2,
      );
    const { startTransaction, promptUI } = await import("./wizard.js");
    const color = input.includes("--no-color") ? false : undefined;
    const openLinks = browserEnabled({
      disabled: input.includes("--no-open"),
      machine,
    });
    let runs: DemoRun[];
    if (arg === "transaction")
      runs = await startTransaction(promptUI(color), undefined, {
        color,
        directory: outOption(rest),
        openLinks,
        verbose,
      });
    else if (arg === "debug" && rest.length === 1)
      runs = await startTransaction(promptUI(color), undefined, {
        color,
        resume: resolveDemoDirectory(rest[0]),
        openLinks,
        verbose,
      });
    else failUsage();
    if (runs.some((run) => ["pending", "inconclusive"].includes(run.state)))
      process.exitCode = 4;
  } else if (command === "wallet" || command === "whoami") {
    const action = command === "whoami" ? "status" : arg,
      flags =
        command === "whoami"
          ? [arg, ...rest].filter((x): x is string => x !== undefined)
          : rest;
    if (
      new Set(flags).size !== flags.length ||
      flags.some((f) => !(action === "status" && f === "--offline"))
    )
      failUsage();
    const result =
      action === "create"
        ? await createWallet()
        : action === "status"
          ? await walletStatus({ offline: flags.includes("--offline") })
          : action === "faucet"
            ? await fundWallet({
                onSubmitted: machine
                  ? undefined
                  : () => console.log(ui.dim("Requesting faucet…")),
              })
            : null;
    if (!result) failUsage();
    out(result, walletLines(result));
    if ("fundingConfirmed" in result && !result.fundingConfirmed)
      process.exitCode = 4;
  } else if (command === "runtime") {
    if (rest.length || !["up", "down"].includes(arg)) failUsage();
    if (arg === "up") await prepareRuntime();
    try {
      execFileSync(process.execPath, [ROOT + "scripts/runtime.mjs", arg], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new FrameShrinkError(
        arg === "up"
          ? "Runtime could not start. Check Docker and port 18545; inspect docker logs frameshrink-ethrex."
          : "Runtime could not stop. Check Docker and retry.",
        3,
      );
    }
    out(
      {
        schemaVersion: 1,
        status: arg === "up" ? "ready" : "stopped",
        chainId: 9,
      },
      [
        ui.badge(arg === "up" ? "READY" : "STOPPED", "green") +
          " Local fixture runtime · chain 9",
      ],
    );
  } else if (command === "demo") {
    if (arg === "local" || !arg) {
      const { localDemo } = await import("./local-demo.js");
      if (!machine) {
        console.log(ui.badge("FrameShrink") + ui.dim(" · LOCAL REPLAY"));
        console.log(ui.dim("Captured signed case · five failure stages"));
      }
      const indicator = activity("Checking the captured case", {
        enabled: !machine,
        color: input.includes("--no-color") ? false : undefined,
      });
      let result: Awaited<ReturnType<typeof localDemo>>;
      try {
        result = await localDemo(outOption(rest), (event) => {
          if (machine) return;
          if (event.kind === "phase") indicator.update(event.message);
          const line = replayLine(
            event,
            input.includes("--no-color") ? false : undefined,
          );
          if (line) indicator.log(line);
        });
      } finally {
        indicator.stop();
      }
      out(result, [
        "",
        ui.badge("PASSED", "green") +
          " Five failures reproduced · corrected check passes",
        reductionMetrics(
          result,
          input.includes("--no-color") ? false : undefined,
        ),
        ui.dim(
          "Captured reduction · exact signed replay · no public submissions",
        ),
      ]);
    } else if (arg === "run") {
      const directory = outOption(rest) ?? defaultDemoDirectory();
      const run = await runDemo(
        directory,
        machine ? undefined : (m) => console.log(ui.ok(m)),
      );
      out(run, demoLines(run));
      if (run.state !== "complete") process.exitCode = 4;
    } else if (["status", "resume"].includes(arg) && rest.length === 1) {
      const run =
        arg === "status"
          ? await loadDemo(resolveDemoDirectory(rest[0]))
          : await resumeDemo(resolveDemoDirectory(rest[0]));
      out(run, demoLines(run));
      if (run.state !== "complete") process.exitCode = 4;
    } else failUsage();
  } else if (command === "debug") {
    if (!arg) failUsage();
    const source = parseExplorerLink(arg),
      directory = outOption(rest) ?? defaultCaseDirectory(source),
      report = await investigate(source);
    await exportInvestigation(report, directory);
    out({ ...report, directory }, investigationLines(report, directory));
    if (report.status === "record-unavailable") process.exitCode = 3;
  } else if (command === "explain") {
    if (!arg || rest.length) failUsage();
    const report = await loadInvestigation(arg);
    out(report, investigationLines(report, path.resolve(arg)));
  } else if (command === "failures") {
    if (arg || rest.length) failUsage();
    out(
      failuresReport(),
      FAILURE_CATALOG.map(
        (f, i) =>
          `${ui.dim(String(i + 1).padStart(2))} ${safe(f.name)}${f.reducer.startsWith("owned ") ? " " + ui.green("[reducible]") : ""}${verbose ? "\n   " + safe(f.example) : ""}`,
      ),
    );
  } else if (command === "doctor") {
    if (arg || rest.length) failUsage();
    const profile = await capture();
    out({ schemaVersion: 1, status: "ready", profile }, [
      ui.ok("Local runtime ready"),
      `Chain ${BigInt(profile.chainId)} · block ${BigInt(profile.headNumber)}`,
      ...(verbose ? [json(profile)] : []),
    ]);
  } else if (command === "inspect") {
    if (!arg || rest.length) failUsage();
    const input = await readJSON(arg),
      result =
        input.mode === "imported"
          ? inspectImported(input)
          : {
              schemaVersion: 1,
              permission: "owned-recipe",
              recipe: parseRecipe(input),
            };
    out(result, [
      ui.cyan(input.name ?? "Imported transaction"),
      safe("permission" in result ? result.permission : "owned"),
      ...(verbose ? [json(result)] : []),
    ]);
  } else if (command === "evaluate") {
    if (!arg || rest.length) failUsage();
    const result = await exclusive(async () =>
      evaluate(parseRecipe(await readJSON(arg)), await capture()),
    );
    out(result, [
      result.status === "accepted"
        ? ui.ok("Accepted by local checks")
        : ui.warn("Rejected · " + result.fingerprint?.ruleId),
      safe(result.message),
      ...(verbose ? [json(result)] : []),
    ]);
  } else if (command === "reduce") {
    if (!arg) failUsage();
    const directory = outOption(rest);
    if (!directory) failUsage();
    const result = await exclusive(async () => {
      const job = await reduce(
        parseRecipe(await readJSON(arg)),
        await capture(),
      );
      await mkdir(path.dirname(directory), { recursive: true });
      await exportBundle(job, directory);
      return {
        schemaVersion: 1,
        status: job.status,
        originalBytes: job.baseline.bytes,
        reducedBytes: job.result.bytes,
        originalFrames: job.baseline.frameIds.length,
        reducedFrames: job.result.frameIds.length,
        evaluations: job.evaluations,
        durationMs: job.durationMs,
        termination: job.termination,
        locallyMinimal: job.locallyMinimal,
        bundle: directory,
      };
    });
    out(result, [
      ui.ok(
        `${result.originalFrames} → ${result.reducedFrames} frames · ${result.originalBytes} → ${result.reducedBytes} bytes`,
      ),
      `${result.evaluations} evaluations · ${safe(result.termination)}`,
      ui.dim(directory),
    ]);
  } else if (command === "replay") {
    if (!arg || rest.length) failUsage();
    const manifest = await readJSON(path.join(arg, "manifest.json"));
    if (manifest.kind === "frameshrink-investigation") {
      const report = await loadInvestigation(arg);
      throw new FrameShrinkError(
        "Diagnostic-only case: " +
          report.reproducibility.missing.length +
          " artifacts missing. Use explain --verbose.",
        3,
      );
    }
    const result =
      manifest.kind === "frameshrink-devnet-case"
        ? await replayDemo(arg)
        : await exclusive(async () => {
            await verifyBundle(arg);
            execFileSync(
              process.execPath,
              [ROOT + "scripts/runtime.mjs", "up"],
              { stdio: ["ignore", "ignore", "pipe"], timeout: 45000 },
            );
            return replay(arg);
          });
    out(result, [
      ui.ok("Clean replay passed"),
      ...result.results.map(
        (r) =>
          `${safe(r.name)} · ${r.status === "accepted" ? ui.green(r.status) : ui.yellow(r.status)}`,
      ),
    ]);
  } else if (command === "compare") {
    if (!arg || rest.length !== 1) failUsage();
    const a = await verifyBundle(arg),
      b = await verifyBundle(rest[0]),
      left = await readJSON(path.join(a.base, "regression.json")),
      right = await readJSON(path.join(b.base, "regression.json"));
    const result = {
      schemaVersion: 1,
      mode: "saved-evidence-comparison",
      sameProfile: a.manifest.profileHash === b.manifest.profileHash,
      samePredicate: hash(left.fingerprint) === hash(right.fingerprint),
      left,
      right,
    };
    out(result, [
      `Profile · ${result.sameProfile ? "same" : "different"}`,
      `Predicate · ${result.samePredicate ? "same" : "different"}`,
    ]);
  } else if (command === "serve") {
    if (arg || rest.length) failUsage();
    await import("./server.js");
  } else failUsage();
} catch (e) {
  const cancelled =
    (e as Error).name === "ExitPromptError" ||
    (e as Error).name === "AbortPromptError";
  const code = cancelled ? 130 : e instanceof FrameShrinkError ? e.exitCode : 4;
  console.error(
    machine
      ? json({
          schemaVersion: 1,
          status: "error",
          message: (e as Error).message,
          exitCode: code,
        })
      : cancelled
        ? ui.dim("Cancelled")
        : ui.error(
            verbose || (e as Error).message.length <= 240
              ? (e as Error).message
              : (e as Error).message.slice(0, 237) + "…",
          ),
  );
  process.exitCode = code;
}
