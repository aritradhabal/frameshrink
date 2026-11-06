import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  ROOT,
  PACKAGED,
  SIDECAR_COMMIT,
  ETHREX_COMMIT,
  IMAGE,
  bytesHash,
  FrameShrinkError,
} from "./shared.js";

export async function assertPinnedSource() {
  if (PACKAGED) {
    const manifest = JSON.parse(
      await readFile(ROOT + "dist/build.json", "utf8"),
    );
    if (
      manifest.schemaVersion !== 1 ||
      manifest.sidecarCommit !== SIDECAR_COMMIT ||
      manifest.ethrexCommit !== ETHREX_COMMIT ||
      manifest.image !== IMAGE ||
      typeof manifest.cliSha256 !== "string" ||
      bytesHash(await readFile(ROOT + "dist/cli.js")) !== manifest.cliSha256
    )
      throw new FrameShrinkError(
        "Installed package does not match its build manifest",
        3,
      );
    return;
  }
  try {
    const vendor = ROOT + ".vendor/sidecar";
    if (
      execFileSync("git", ["-C", vendor, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim() !== SIDECAR_COMMIT ||
      execFileSync(
        "git",
        ["-C", vendor, "status", "--porcelain", "--untracked-files=no"],
        { encoding: "utf8" },
      ).trim()
    )
      throw Error("mismatch");
  } catch {
    throw new FrameShrinkError(
      "Pinned sidecar source missing or modified; run npm run bootstrap in the source checkout",
      3,
    );
  }
}
