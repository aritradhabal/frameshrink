import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withRuntimeLock } from "./runtime-lock.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
export const image =
  "ghcr.io/forshtat/eip8141-devnet@sha256:09e0871af79cb06ee3cf3f7bc760a39bdcb539bc9c8d1ef1fe8a1bf57962030e";
const name = "frameshrink-ethrex";
export async function manageRuntime(action) {
  return withRuntimeLock(async () => {
    if (action === "down") {
      try {
        execFileSync("docker", ["rm", "-f", name], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch (error) {
        if (!String(error.stderr).includes("No such container")) throw error;
      }
    } else if (action === "up") {
      JSON.parse(readFileSync(root + "fixtures/genesis.json"));
      try {
        execFileSync("docker", ["rm", "-f", name], {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch {}
      execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--platform",
          "linux/amd64",
          "--name",
          name,
          "-p",
          "127.0.0.1:18545:8545",
          "--mount",
          `type=bind,source=${root}fixtures/genesis.json,target=/frameshrink-genesis.json,readonly`,
          image,
          "--network",
          "/frameshrink-genesis.json",
          "--http.addr",
          "0.0.0.0",
          "--http.port",
          "8545",
          "--http.api",
          "eth,net,web3,ethrex,debug",
        ],
        { stdio: "pipe", timeout: 30000 },
      );
      for (let i = 0; i < 60; i++) {
        try {
          const r = await fetch("http://127.0.0.1:18545", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_chainId",
              params: [],
            }),
            signal: AbortSignal.timeout(2000),
          }).then((r) => r.json());
          if (r.result === "0x9") {
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      throw Error(
        "Runtime did not become ready. On Apple Silicon enable Docker Rosetta support. See docker logs frameshrink-ethrex.",
      );
    } else throw Error("Usage: node scripts/runtime.mjs up|down");
  });
}
if (
  process.argv[1]?.endsWith("runtime.mjs") &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await manageRuntime(process.argv[2]);
    if (process.argv[2] === "up")
      console.log("FrameShrink local ethrex ready (chain 9, no mining).");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 4;
  }
}
