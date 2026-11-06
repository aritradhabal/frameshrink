import { assertPinnedSource } from "./provenance.js";
import { execFileSync } from "node:child_process";
import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  IMAGE,
  SIDECAR_COMMIT,
  ETHREX_COMMIT,
  FrameShrinkError,
  bytesHash,
  hash,
  saveJSON,
} from "./shared.js";
import { rpc, POLICY, type Profile } from "./runtime.js";
import { ContextSchema, type CaseContext } from "./self-relay.js";
export const CASE_ENDPOINT = "http://127.0.0.1:18546";
const container = "frameshrink-case-ethrex";
export async function makeCaseGenesis(context: CaseContext, directory: string) {
  const genesis = JSON.parse(
    await readFile(ROOT + "fixtures/genesis.upstream.json", "utf8"),
  );
  genesis.config.chainId = 1337;
  genesis.alloc[context.address.slice(2).toLowerCase()] = {
    balance: context.balance,
    nonce: context.nonce,
    code: "0x",
    storage: {},
  };
  if (context.validator)
    genesis.alloc[context.validator.address.slice(2).toLowerCase()] = {
      balance: context.validator.balance,
      nonce: context.validator.nonce,
      code: context.validator.code,
      storage: {},
    };
  await saveJSON(path.join(directory, "genesis.json"), genesis);
}
export async function startCaseRuntime(directory: string) {
  const file = await realpath(path.join(directory, "genesis.json"));
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 2097152)
    throw new FrameShrinkError("Invalid case genesis", 2);
  const genesis = JSON.parse(await readFile(file, "utf8"));
  if (genesis.config?.chainId !== 1337)
    throw new FrameShrinkError(
      "Case runtime requires reconstructed chain 1337",
      3,
    );
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "pipe" });
  } catch {}
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--platform",
      "linux/amd64",
      "--name",
      container,
      "-p",
      "127.0.0.1:18546:8545",
      "--mount",
      `type=bind,source=${file},target=/case-genesis.json,readonly`,
      IMAGE,
      "--network",
      "/case-genesis.json",
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
      if ((await rpc("eth_chainId", [], CASE_ENDPOINT)) === "0x539") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new FrameShrinkError(
    "Case runtime did not start; inspect docker logs frameshrink-case-ethrex",
    4,
  );
}
export async function captureCaseProfile(
  context: CaseContext,
  directory: string,
): Promise<Profile> {
  ContextSchema.parse(context);
  await assertPinnedSource();
  const inspect = JSON.parse(
    execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
  )[0];
  const file = await realpath(path.join(directory, "genesis.json"));
  const mount = inspect.Mounts.find(
    (m: any) => m.Destination === "/case-genesis.json",
  );
  if (
    inspect.Config.Image !== IMAGE ||
    !inspect.State.Running ||
    !mount ||
    mount.RW ||
    mount.Source !== file
  )
    throw new FrameShrinkError("Case container identity mismatch", 3);
  const call = (method: string, params: unknown[] = []) =>
    rpc(method, params, CASE_ENDPOINT);
  const [chainId, head, code, balance, nonce, clientVersion] =
    await Promise.all([
      call("eth_chainId"),
      call("eth_getBlockByNumber", ["latest", false]),
      call("eth_getCode", [context.address, "0x0"]),
      call("eth_getBalance", [context.address, "0x0"]),
      call("eth_getTransactionCount", [context.address, "0x0"]),
      call("web3_clientVersion"),
    ]);
  if (
    chainId !== "0x539" ||
    head.number !== "0x0" ||
    code !== "0x" ||
    BigInt(balance) !== BigInt(context.balance) ||
    BigInt(nonce) !== BigInt(context.nonce)
  )
    throw new FrameShrinkError(
      "Reconstructed account state does not match the captured case",
      3,
    );
  const accounts: Profile["accounts"] = {
    [context.address]: { code: code as "0x", balance, nonce },
  };
  if (context.validator) {
    const expected = context.validator;
    const [code, balance, nonce] = await Promise.all([
      call("eth_getCode", [expected.address, "0x0"]),
      call("eth_getBalance", [expected.address, "0x0"]),
      call("eth_getTransactionCount", [expected.address, "0x0"]),
    ]);
    if (
      code !== expected.code ||
      BigInt(balance) !== BigInt(expected.balance) ||
      BigInt(nonce) !== BigInt(expected.nonce)
    )
      throw new FrameShrinkError(
        "Reconstructed validator differs from captured state",
        3,
      );
    accounts[expected.address] = { code, balance, nonce };
  }
  const base = {
    schemaVersion: 1 as const,
    sidecarCommit: SIDECAR_COMMIT,
    ethrexCommit: ETHREX_COMMIT,
    image: IMAGE,
    genesisFileHash: bytesHash(await readFile(file)),
    genesisHash: head.hash,
    headHash: head.hash,
    headNumber: head.number,
    chainId,
    clientVersion,
    accounts,
    policy: POLICY,
    policyHash: hash(POLICY),
  };
  return {
    ...base,
    profileHash: hash(base),
    stateHash: hash({ head: head.hash, accounts, policy: POLICY }),
  };
}
