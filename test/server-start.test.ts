import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { startWorkbench } from "../src/server.js";
import { FrameShrinkError } from "../src/shared.js";

test("occupied workbench port produces an actionable controlled error", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(0, "127.0.0.1", resolve),
  );
  try {
    const address = occupied.address();
    assert(address && typeof address === "object");
    await assert.rejects(
      () => startWorkbench({ port: address.port }),
      (error) => {
        assert(error instanceof FrameShrinkError);
        assert.equal(error.exitCode, 3);
        assert.match(error.message, /port .* is in use/);
        assert(!error.message.includes("EADDRINUSE"));
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("JSON workbench startup emits one ready object and serves the reported URL", async () => {
  const output: string[] = [];
  const server = await startWorkbench({
    port: 0,
    machine: true,
    output: (line) => output.push(line),
  });
  try {
    assert.equal(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.equal(result.status, "ready");
    assert.equal(result.schemaVersion, 1);
    const response = await fetch(result.url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /FrameShrink/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
