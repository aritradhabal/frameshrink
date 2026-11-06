import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  editorWords,
  editorCommand,
  openPreview,
  transactionPreview,
  changesPreview,
  changeDetails,
} from "../src/preview.js";
import { readJSON, ROOT } from "../src/shared.js";
import type { DebugStage, SignedCase } from "../src/demo.js";
import { ContextSchema } from "../src/self-relay.js";
import {
  correctionDiff,
  evaluationLine,
  FAILURE_CHOICES,
} from "../src/wizard.js";

test("editor commands honor VISUAL then EDITOR, preserve quoted arguments and never require a shell", () => {
  assert.deepEqual(
    editorWords('"/Applications/Editor With Spaces/bin/edit" --wait "a b"'),
    ["/Applications/Editor With Spaces/bin/edit", "--wait", "a b"],
  );
  assert.deepEqual(editorWords("editor 'literal $(echo x);&'"), [
    "editor",
    "literal $(echo x);&",
  ]);
  assert.deepEqual(
    editorCommand(
      "/tmp/a b.md",
      { VISUAL: "zed --wait", EDITOR: "nano" },
      "darwin",
    ),
    { command: "zed", args: ["--wait", "/tmp/a b.md"] },
  );
  assert.deepEqual(editorCommand("/tmp/a b.md", { EDITOR: "nano" }, "darwin"), {
    command: "nano",
    args: ["/tmp/a b.md"],
  });
  assert.deepEqual(editorCommand("/tmp/a b.md", {}, "darwin"), {
    command: "open",
    args: ["-t", "/tmp/a b.md"],
  });
  assert.throws(() => editorWords('editor "unfinished'), /unfinished/);
});

test("editor opens only a view-only preview copy with correctly separated file arguments", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "frameshrink-editor-"));
  const previous = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  let file: string | undefined;
  try {
    const script = path.join(directory, "editor with spaces.mjs"),
      log = path.join(directory, "args.json");
    await writeFile(
      script,
      'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));',
    );
    process.env.VISUAL = `"${process.execPath}" "${script}" "${log}"`;
    file = await openPreview("# View only\n", "transaction");
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")), [file]);
    assert.equal(await readFile(file, "utf8"), "# View only\n");
    assert.equal((await stat(file)).mode & 0o222, 0);
  } finally {
    for (const key of ["VISUAL", "EDITOR"] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (file) await rm(path.dirname(file), { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured previews decode actual frames and show removed calls, inputs and every correction stage", async () => {
  const dir = ROOT + "evidence/wizard-combined/";
  const original: SignedCase = await readJSON(dir + "original.json");
  const stages: DebugStage[] = await readJSON(dir + "debug-stages.json");
  const context = ContextSchema.parse(await readJSON(dir + "context.json"));
  const preview = transactionPreview(original, context);
  assert.match(preview, /767 canonical bytes/);
  assert.match(preview, /0: validation/);
  assert.match(preview, /VERIFY \(validation \+ fee approval\)/);
  assert.match(preview, /Decoded uint256\[\]: \[1,2,3,4\]/);
  assert.match(preview, /Gas limits: execution 30000/);
  assert(preview.includes(original.raw));
  assert(!preview.includes("privateKey"));
  const changes = changesPreview(stages, context);
  assert.match(changes, /extra-a.*optional call removed/);
  assert.match(changes, /required-call.*\[1,2,3,4\] → \[\]/);
  assert.match(changes, /mode 3 → 2.*TIMESTAMP/);
  assert.match(changes, /mode 2 → 0.*NUMBER/);
  assert(changes.includes(stages.at(-1)!.correction.raw));
  assert.equal(changeDetails(stages).length, 5);
  const summary = correctionDiff(
    await readJSON(dir + "run.json"),
    stages,
    false,
  ).join("\n");
  assert.match(summary, /extra-b/);
  assert.match(summary, /re-signed/);
  for (const choice of FAILURE_CHOICES.filter((c) => c.disabled))
    assert.match(choice.disabled!, /^— .*future release/);
  const line = evaluationLine(
    1,
    "BANNED_OPCODE:TIMESTAMP",
    {
      evaluation: 4,
      phase: "candidate",
      edit: { kind: "remove-frames", ids: ["extra-a"] },
      bytes: 500,
      status: "rejected",
      sameFailure: true,
      cause: "BANNED_OPCODE:TIMESTAMP",
    },
    false,
  );
  assert.match(line, /\[1.4\].*extra-a.*same failure.*500 bytes/);
});
