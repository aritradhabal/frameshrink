import {
  recipeMask,
  modeLabels,
  failureLabel,
  FAILURE_MODES,
} from "./failure-modes.js";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIRECTORY, json, FrameShrinkError } from "./shared.js";
import { decodeSignedCase, type SignedCase, type DebugStage } from "./demo.js";
import type { CaseContext } from "./self-relay.js";

// Parse editor arguments without invoking a shell or expanding shell expressions.
export function editorWords(value: string): string[] {
  const words: string[] = [];
  let word = "",
    quote = "",
    escaped = false,
    active = false;
  for (const ch of value) {
    if (escaped) {
      word += ch;
      escaped = false;
      active = true;
    } else if (ch === "\\" && quote !== "'") {
      escaped = true;
      active = true;
    } else if (quote) {
      if (ch === quote) quote = "";
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      active = true;
    } else if (/\s/.test(ch)) {
      if (active) {
        words.push(word);
        word = "";
        active = false;
      }
    } else {
      word += ch;
      active = true;
    }
  }
  if (quote || escaped)
    throw new FrameShrinkError(
      "VISUAL/EDITOR has an unfinished quote or escape",
      2,
    );
  if (active) words.push(word);
  if (!words[0]) throw new FrameShrinkError("VISUAL/EDITOR is empty", 2);
  return words;
}
export function editorCommand(
  file: string,
  env = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (configured) {
    const [command, ...args] = editorWords(configured);
    return { command, args: [...args, file] };
  }
  if (platform === "darwin") return { command: "open", args: ["-t", file] };
  if (platform === "win32")
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", file],
    };
  return { command: "xdg-open", args: [file] };
}
export async function openPreview(
  content: string,
  kind: "transaction" | "changes",
) {
  const parent = path.join(DATA_DIRECTORY, "previews");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, kind + "-"));
  const file = path.join(directory, kind + ".md");
  // This is a view-only copy; editor changes never enter signing or replay.
  await writeFile(file, content, { mode: 0o444 });
  const { command, args } = editorCommand(file);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.once("error", () =>
      reject(
        new FrameShrinkError(
          `Could not open editor; preview saved at ${file}`,
          4,
        ),
      ),
    );
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT") {
        const error = new Error("Cancelled");
        error.name = "ExitPromptError";
        reject(error);
      } else if (code === 0) resolve();
      else
        reject(
          new FrameShrinkError(
            `Editor exited unsuccessfully; preview saved at ${file}`,
            4,
          ),
        );
    });
  });
  return file;
}
export function transactionPreview(
  record: SignedCase,
  context: CaseContext,
): string {
  const { tx } = decodeSignedCase(record, context);
  return [
    "# Transaction preview",
    "",
    "View-only copy. Editing this file does not change the transaction.",
    "",
    `Hash: ${record.hash}`,
    `Chain: ${tx.chainId}`,
    `Owner: ${context.address}`,
    `Sender / validator: ${tx.sender}`,
    `Nonce: ${tx.nonceSeq}`,
    `Size: ${tx.frames.length} frames / ${(record.raw.length - 2) / 2} canonical bytes`,
    "Frame ETH transfers: 0. If included, gas is paid by the validator. Admission rejection does not charge on-chain gas.",
    "",
    "## Frames",
    "",
    ...tx.frames.flatMap((frame, index) => {
      const body = record.recipe.body[index - 1];
      return [
        `### ${index}: ${record.frameIds[index]}`,
        "",
        `Mode: ${frame.mode === 1 ? "VERIFY (validation + fee approval)" : "SENDER (execution)"}`,
        `Target: ${frame.target ?? tx.sender + " (sender)"}`,
        `Gas limits: execution ${frame.limits.execution}, state ${frame.limits.state}`,
        `Value: ${frame.value} wei`,
        body
          ? `Decoded uint256[]: ${JSON.stringify(body.values)}`
          : `Validation mode: ${recipeMask(record.recipe)} (${modeLabels(recipeMask(record.recipe)) || "all failure branches disabled"})`,
        `Calldata: ${frame.data}`,
        "",
      ];
    }),
    "## Signed transaction",
    "",
    "```json",
    json(tx),
    "```",
    "",
    "## Canonical encoded transaction",
    "",
    record.raw,
    "",
  ].join("\n");
}
export function changeDetails(stages: DebugStage[]): string[] {
  if (!stages.length) return [];
  const before = stages[0].original.recipe;
  const after = stages.at(-1)!.correction.recipe;
  const lines: string[] = [];
  before.body.forEach((frame, index) => {
    const retained = after.body.find((f) => f.id === frame.id);
    if (!retained)
      lines.push(
        `− frame ${index + 1} ${frame.id} · optional call removed (${frame.values.length} input values)`,
      );
    else if (JSON.stringify(frame.values) !== JSON.stringify(retained.values))
      lines.push(
        `~ frame ${index + 1} ${frame.id} · uint256[] ${JSON.stringify(frame.values)} → ${JSON.stringify(retained.values)}`,
      );
  });
  const mode = (record: SignedCase) => recipeMask(record.recipe);
  for (const stage of stages) {
    const correction =
      FAILURE_MODES.find((failure) => failure.cause === stage.failure)
        ?.correction ?? failureLabel(stage.failure);
    lines.push(
      `~ validation mode ${mode(stage.original)} → ${mode(stage.correction)} · ${correction}`,
    );
  }
  return lines;
}
export function changesPreview(
  stages: DebugStage[],
  context: CaseContext,
): string {
  const original = stages[0].original,
    corrected = stages.at(-1)!.correction;
  return [
    "# Changes",
    "",
    "View-only copies. Editing this file does not change the correction.",
    "",
    ...changeDetails(stages),
    "",
    "Owner authorization remains enabled. Edited candidates are signed again.",
    "Each reduction preserves its own failure fingerprint. Intermediate fixes expose the next failure; the final control passes locally.",
    "",
    ...stages.flatMap((stage, index) => [
      `## Debug stage ${index + 1}: ${stage.failure}`,
      "",
      `${stage.evaluations} local evaluations`,
      `Fingerprint: ${json(stage.fingerprint)}`,
      "",
      "Original recipe:",
      "```json",
      json(stage.original.recipe),
      "```",
      "Reduced recipe:",
      "```json",
      json(stage.reduced.recipe),
      "```",
      "Correction recipe:",
      "```json",
      json(stage.correction.recipe),
      "```",
      "",
    ]),
    "## Full before transaction",
    "",
    transactionPreview(original, context),
    "## Full corrected transaction",
    "",
    transactionPreview(corrected, context),
  ].join("\n");
}
