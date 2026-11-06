import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { activity, fitStatus } from "../src/presentation.js";

function output(isTTY = true) {
  const chunks: string[] = [];
  const stream = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    }),
    { isTTY, columns: 48 },
  );
  return { chunks, stream };
}

test("hundreds of live checks reuse one bounded row and stop redrawing after cleanup", () => {
  const { chunks, stream } = output();
  const indicator = activity("Starting", {
    output: stream,
    color: false,
    env: {},
  });
  for (let n = 1; n <= 400; n++)
    indicator.update(`Check ${n} · ${"candidate ".repeat(20)}`);
  indicator.stop();
  const count = chunks.length;
  indicator.update("Must not redraw");
  assert.equal(chunks.length, count);
  assert(!chunks.join("").includes("\n"));
  for (const chunk of chunks) {
    const text = chunk.replace(/\r|\x1b\[[0-9;]*m|\x1b\[2K/g, "");
    assert([...text].length < stream.columns);
  }
  assert.equal(chunks.at(-1), "\r\x1b[2K");
  assert(!fitStatus("bad\x1b[31m", 80).includes("\x1b"));
});

test("CI, dumb terminals, redirected output and disabled activity never emit cursor controls", () => {
  for (const options of [
    { env: { TERM: "dumb" } },
    { env: { CI: "1" } },
    { enabled: false, env: {} },
    { env: {}, redirected: true },
  ]) {
    const { chunks, stream } = output(!options.redirected);
    const indicator = activity("Checking", {
      ...options,
      output: stream,
      color: false,
    });
    indicator.update("Next check");
    indicator.stop();
    assert.equal(chunks.join(""), "");
  }
});
