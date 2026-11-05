import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
declare const __FRAMESHRINK_PACKAGED__: boolean;
export const PACKAGED =
  typeof __FRAMESHRINK_PACKAGED__ !== "undefined" && __FRAMESHRINK_PACKAGED__;
export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DATA_DIRECTORY = process.env.FRAMESHRINK_HOME
  ? path.resolve(process.env.FRAMESHRINK_HOME)
  : PACKAGED
    ? path.join(homedir(), ".frameshrink")
    : path.join(ROOT, ".runs");
export const SIDECAR_COMMIT = "2e22ff0a2898e69ea4bf5275bce1be8581a8582a";
export const ETHREX_COMMIT = "9aa3645d795945c64400f41a70aace0edfa7f383";
export const IMAGE =
  "ghcr.io/forshtat/eip8141-devnet@sha256:09e0871af79cb06ee3cf3f7bc760a39bdcb539bc9c8d1ef1fe8a1bf57962030e";
export function json(v: unknown): string {
  return JSON.stringify(
    v,
    (_, x) => (typeof x === "bigint" ? "0x" + x.toString(16) : x),
    2,
  );
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(typeof v === "bigint" ? "0x" + v.toString(16) : v);
}
export const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const bytesHash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
export class FrameShrinkError extends Error {
  constructor(
    message: string,
    public exitCode = 4,
  ) {
    super(message);
  }
}
export async function readJSON(path: string) {
  const b = await readFile(path);
  if (b.length > 262144) throw new FrameShrinkError("Input exceeds 256 KiB", 2);
  try {
    return JSON.parse(b.toString());
  } catch {
    throw new FrameShrinkError("Invalid JSON", 2);
  }
}
export async function saveJSON(path: string, v: unknown) {
  await writeFile(path, json(v) + "\n");
}
