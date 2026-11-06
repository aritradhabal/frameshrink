import { test } from "node:test";
import assert from "node:assert/strict";
import { terminal } from "../src/terminal.js";
import { changeDetails, changesPreview } from "../src/preview.js";
import { readJSON, ROOT } from "../src/shared.js";
import { ContextSchema } from "../src/self-relay.js";
import type { DebugStage } from "../src/demo.js";

test("terminal respects dumb output and dims the user's palette without fixing metadata to grey", () => {
  const before = {
    TERM: process.env.TERM,
    FORCE_COLOR: process.env.FORCE_COLOR,
    NO_COLOR: process.env.NO_COLOR,
  };
  try {
    process.env.TERM = "dumb";
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    assert.equal(terminal().ok("ready"), "✓ ready");
    assert.equal(terminal().badge("READY"), "[READY]");
    assert.equal(terminal(true).dim("metadata"), "\x1b[2mmetadata\x1b[0m");
  } finally {
    for (const name of ["TERM", "FORCE_COLOR", "NO_COLOR"] as const) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("terminal changes use failure names while the editor retains exact validation masks", async () => {
  const directory = ROOT + "evidence/wizard-combined/";
  const stages: DebugStage[] = await readJSON(directory + "debug-stages.json");
  const context = ContextSchema.parse(
    await readJSON(directory + "context.json"),
  );
  const terminalSummary = changeDetails(stages).join("\n");
  assert.match(terminalSummary, /Forbidden TIMESTAMP · skip TIMESTAMP/);
  assert.match(terminalSummary, /Forbidden NUMBER · skip NUMBER/);
  assert.doesNotMatch(terminalSummary, /validation mode/);
  const editorPreview = changesPreview(stages, context);
  assert.match(editorPreview, /validation mode 3 → 2/);
  assert.match(editorPreview, /validation mode 2 → 0/);
});
