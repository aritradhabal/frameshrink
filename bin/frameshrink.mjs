#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
if (existsSync(source)) {
  const child = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), source, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
} else {
  await import("../dist/cli.js");
}
