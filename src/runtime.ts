import { assertPinnedSource } from "./provenance.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { type Hex } from "viem";
import { FrameTxValidationService } from "../.vendor/sidecar/packages/executor/lib/services/UserOpValidation/validators/frameTx.js";
import { validateSignature } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/signature.js";
import { FIXTURE_REVERT, FAILURE_MODES } from "./failure-modes.js";
import { validatorRuntime } from "./validator-code.js";
import { assertSelfRelay, computeSigHash } from "./self-relay.js";
import { encodeRawFrameTx } from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import { CheckCollector } from "../.vendor/sidecar/packages/executor/lib/services/ExplorerService/checkCollector.js";
import type { EthrexSimulateFrameTransactionResult } from "../.vendor/sidecar/packages/types/lib/executor/validation/ethrexFrameTx.js";
import type { FrameTransaction } from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
import {
  ROOT,
  SIDECAR_COMMIT,
  ETHREX_COMMIT,
  IMAGE,
  hash,
  bytesHash,
  FrameShrinkError,
} from "./shared.js";
import { build, WALLET, BANNED, SINK, type Recipe } from "./recipe.js";
export const ENDPOINT = "http://127.0.0.1:18545";
const METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getBalance",
  "eth_getTransactionCount",
  "ethrex_simulateFrameTransaction",
  "web3_clientVersion",
]);
export async function rpc(
  method: string,
  params: unknown[] = [],
  endpoint: string = ENDPOINT,
): Promise<any> {
  if (![ENDPOINT, "http://127.0.0.1:18546"].includes(endpoint))
    throw new FrameShrinkError("Local simulation endpoint not allowed", 3);
  if (!METHODS.has(method))
    throw new FrameShrinkError("RPC method not allowed", 3);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 4 * 1024 * 1024)
      throw Error("RPC response exceeds 4 MiB");
    const data = JSON.parse(text);
    if (data.error) throw Error(JSON.stringify(data.error));
    if (data.result === undefined) throw Error("Missing RPC result");
    return data.result;
  } catch (e) {
    throw new FrameShrinkError(`RPC ${method}: ${(e as Error).message}`, 4);
  }
}
export const POLICY = {
  stakingRegistry: "disabled",
  stake: "0x0",
  unstakeDelaySec: "0x0",
  whitelist: [],
  reputation: "all unlisted; insufficient stake",
  minStake: "0x2540be400",
  standardMempoolId: "FrameShrink-local-policy",
  scope:
    "upstream FrameTxValidationService; no mempool, fees, replacement, reputation admission or gossip",
};
export type Profile = {
  schemaVersion: 1;
  sidecarCommit: string;
  ethrexCommit: string;
  image: string;
  genesisFileHash: string;
  genesisHash: string;
  headHash: string;
  headNumber: string;
  chainId: string;
  clientVersion: string;
  accounts: Record<string, { code: Hex; balance: string; nonce: string }>;
  policy: typeof POLICY;
  policyHash: string;
  profileHash: string;
  stateHash: string;
};
export async function capture(): Promise<Profile> {
  await assertPinnedSource();
  const commit = SIDECAR_COMMIT;
  let container: any;
  try {
    container = JSON.parse(
      execFileSync("docker", ["inspect", "frameshrink-ethrex"], {
        encoding: "utf8",
      }),
    )[0];
  } catch {
    throw new FrameShrinkError(
      "Owned runtime container missing; run frameshrink runtime up",
      3,
    );
  }
  if (container.Config.Image !== IMAGE || !container.State.Running)
    throw new FrameShrinkError(
      "Runtime container is not the pinned running image",
      3,
    );
  const [chainId, genesis, head, clientVersion] = await Promise.all([
    rpc("eth_chainId"),
    rpc("eth_getBlockByNumber", ["0x0", false]),
    rpc("eth_getBlockByNumber", ["latest", false]),
    rpc("web3_clientVersion"),
  ]);
  if (chainId !== "0x9" || head.number !== "0x0")
    throw new FrameShrinkError(
      "Requires isolated chain 9 at genesis with no mining",
      3,
    );
  const genesisBytes = await readFile(ROOT + "fixtures/genesis.json");
  const expected = JSON.parse(genesisBytes.toString());
  const accounts: Profile["accounts"] = {};
  for (const address of [WALLET, BANNED, SINK]) {
    const [code, balance, nonce] = await Promise.all([
      rpc("eth_getCode", [address, "0x0"]),
      rpc("eth_getBalance", [address, "0x0"]),
      rpc("eth_getTransactionCount", [address, "0x0"]),
    ]);
    const entry = expected.alloc[address.slice(2)];
    if (
      code !== entry.code ||
      BigInt(balance) !== BigInt(entry.balance) ||
      BigInt(nonce) !== 1n
    )
      throw new FrameShrinkError(
        `Owned genesis account mismatch: ${address}`,
        3,
      );
    accounts[address] = { code, balance, nonce };
  }
  // Exact client/genesis identity is enforced by the pinned image, readonly genesis mount and code/balance checks.
  const mount = container.Mounts.find(
    (m: any) => m.Destination === "/frameshrink-genesis.json",
  );
  if (!mount || mount.RW || mount.Source !== ROOT + "fixtures/genesis.json")
    throw new FrameShrinkError("Requires readonly project genesis mount", 3);
  const profileBase = {
    schemaVersion: 1 as const,
    sidecarCommit: commit,
    ethrexCommit: ETHREX_COMMIT,
    image: IMAGE,
    genesisFileHash: bytesHash(genesisBytes),
    genesisHash: genesis.hash,
    headHash: head.hash,
    headNumber: head.number,
    chainId,
    clientVersion,
    accounts,
    policy: POLICY,
    policyHash: hash(POLICY),
  };
  return {
    ...profileBase,
    profileHash: hash({ ...profileBase, headHash: undefined }),
    stateHash: hash({ head: head.hash, accounts, policy: POLICY }),
  };
}
export type Fingerprint = {
  stage: string;
  ruleId: string;
  normalizedCause: string;
  entityRole: string | null;
  stableFixtureFrameId: string | null;
  profileHash: string;
  stateHash: string;
};
export type Evaluation = {
  status: "accepted" | "rejected";
  fingerprint: Fingerprint | null;
  raw: Hex;
  frameIds: string[];
  checks: ReturnType<CheckCollector["toChecks"]>;
  simulation: EthrexSimulateFrameTransactionResult;
  message: string;
  bytes: number;
};
export function fingerprint(
  check: ReturnType<CheckCollector["toChecks"]>[number],
  message: string,
  frameIds: string[],
  profile: Profile,
): Fingerprint {
  let cause = message;
  if (/exceeds MAX_VERIFY_GAS/.test(message))
    cause = "MAX_VERIFY_GAS:declared-prefix-plus-signatures";
  else if (/banned opcode: TIMESTAMP|BannedOpcode\(66\)/.test(message))
    cause = "BANNED_OPCODE:TIMESTAMP";
  else if (/banned opcode: NUMBER|BannedOpcode\(67\)/.test(message))
    cause = "BANNED_OPCODE:NUMBER";
  else if (/accesses un-deployed contract address.*EXTCODESIZE/.test(message))
    cause = "CODE_ACCESS:OWNER_NO_CODE";
  return {
    stage: "local-policy",
    ruleId: check.rule,
    normalizedCause: cause,
    entityRole: check.entity ?? null,
    stableFixtureFrameId:
      check.frameIndex === undefined
        ? null
        : (frameIds[check.frameIndex] ?? null),
    profileHash: profile.profileHash,
    stateHash: profile.stateHash,
  };
}
export async function evaluate(
  recipe: Recipe,
  profile: Profile,
): Promise<Evaluation> {
  const built = await build(recipe);
  return evaluateTx(built.tx, built.raw, built.frameIds, profile);
}
export type ExecutionFailure = "application-revert" | "static-write";
export async function ownedExecutionFingerprint(
  tx: FrameTransaction,
  simulation: EthrexSimulateFrameTransactionResult,
  frameIds: string[],
  profile: Profile,
  expected: ExecutionFailure,
): Promise<Fingerprint> {
  assertSelfRelay(tx);
  const owner = tx.signatures[0].signer;
  const account = Object.entries(profile.accounts).find(
    ([address]) => address.toLowerCase() === tx.sender.toLowerCase(),
  )?.[1];
  const mask = Number(BigInt(tx.frames[0].data));
  const mode = FAILURE_MODES.find((mode) => mask & mode.bit);
  const validSignature = await validateSignature(
    tx.signatures[0],
    tx.sender,
    computeSigHash(tx),
  );
  if (
    !validSignature ||
    account?.code !== validatorRuntime(owner, 3) ||
    mode?.id !== expected ||
    simulation.failedFrameIndex !== 0 ||
    simulation.executionStatus !== null ||
    simulation.frames !== null ||
    simulation.gasUsed !== null ||
    simulation.erc7562Trace !== null ||
    simulation.erc7562TraceError !== null ||
    simulation.canonicalMempoolValid !== false ||
    simulation.canonicalMempoolViolation !==
      "validation prefix frame reverted" ||
    !simulation.executionError
      ?.toLowerCase()
      .includes(`verify frame 0 (target ${tx.sender.toLowerCase()},`) ||
    (expected === "application-revert"
      ? simulation.haltReason !== "revert" ||
        simulation.revertData !== FIXTURE_REVERT
      : simulation.haltReason !== "static_violation" ||
        simulation.haltDetail !== "Opcode Not Allowed In Static Context" ||
        (simulation.revertData !== undefined && simulation.revertData !== "0x"))
  )
    throw new FrameShrinkError(
      "Simulation does not prove the selected owned execution failure",
      5,
    );
  return {
    stage: "local-execution",
    ruleId: "simulation",
    normalizedCause: mode.cause,
    entityRole: "payer",
    stableFixtureFrameId: frameIds[0],
    profileHash: profile.profileHash,
    stateHash: profile.stateHash,
  };
}
export async function evaluateTx(
  tx: FrameTransaction,
  raw: Hex,
  frameIds: string[],
  profile: Profile,
  capturedCase = false,
  expectedExecutionFailure?: ExecutionFailure,
): Promise<Evaluation> {
  const call = (method: string, params: unknown[]) =>
    rpc(method, params, capturedCase ? "http://127.0.0.1:18546" : ENDPOINT);
  if (
    encodeRawFrameTx(tx) !== raw ||
    frameIds.length !== tx.frames.length ||
    new Set(frameIds).size !== frameIds.length
  )
    throw new FrameShrinkError(
      "Transaction metadata, canonical bytes and stable frame IDs must agree",
      2,
    );
  if (
    tx.chainId !== (capturedCase ? 1337n : 9n) ||
    BigInt(profile.chainId) !== tx.chainId
  )
    throw new FrameShrinkError(
      "Transaction does not match the selected local profile",
      3,
    );
  const before = await call("eth_getBlockByNumber", ["latest", false]);
  if (before.hash !== profile.headHash)
    throw new FrameShrinkError("State drift before simulation");
  const simulation = (await call("ethrex_simulateFrameTransaction", [
    raw,
    "0x0",
    { trace: true },
  ])) as EthrexSimulateFrameTransactionResult;
  if (expectedExecutionFailure) {
    if (!capturedCase)
      throw new FrameShrinkError(
        "Controlled execution failures require captured v3 state",
        3,
      );
    const fp = await ownedExecutionFingerprint(
      tx,
      simulation,
      frameIds,
      profile,
      expectedExecutionFailure,
    );
    const after = await call("eth_getBlockByNumber", ["latest", false]);
    if (after.hash !== profile.headHash)
      throw new FrameShrinkError("State drift after simulation");
    const collector = new CheckCollector();
    collector.fail("simulation", simulation.executionError!, {
      frameIndex: 0,
      entity: "payer",
    });
    return {
      status: "rejected",
      fingerprint: fp,
      raw,
      frameIds,
      checks: collector.toChecks(),
      simulation,
      message: simulation.executionError!,
      bytes: (raw.length - 2) / 2,
    };
  }
  // Even a structural predicate requires real successful execution and trace data, preventing a different execution failure from masquerading as it.
  if (
    simulation.erc7562Trace == null ||
    !Array.isArray(simulation.erc7562Trace) ||
    !/^0x[0-9a-f]+$/i.test(simulation.gasUsed ?? "") ||
    !Array.isArray(simulation.frames) ||
    simulation.frames.length !== tx.frames.length ||
    simulation.frames.some((f) => f.succeeded !== true) ||
    simulation.executionStatus !== "success" ||
    simulation.executionError != null
  )
    throw new FrameShrinkError(
      "Simulation lacks complete trace/execution evidence: " +
        JSON.stringify(simulation),
    );
  const collector = new CheckCollector();
  const logger = {
    debug() {},
    error() {},
    info() {},
    warn() {},
    trace() {},
    fatal() {},
  };
  const validator = new FrameTxValidationService(
    {
      getDepositInfo: async () => ({
        stake: 0n,
        unstakeDelaySec: 0n,
        withdrawTime: 0n,
      }),
    } as any,
    {
      checkStake: async () => ({ code: 1, msg: "Fixture has no stake" }),
    } as any,
    {
      minStake: 10000000000n,
      precompiles: Array.from(
        { length: 17 },
        (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"),
      ),
      whitelistedEntities: { sender: [], payer: [], factory: [], external: [] },
      standardMempoolId: POLICY.standardMempoolId,
    } as any,
    logger as any,
  );
  let message = "Accepted by local simulation and covered policy checks";
  let fp: Fingerprint | null = null;
  try {
    await validator.validate(tx, simulation, collector);
  } catch (e) {
    message = (e as Error).message;
    const first = collector.toChecks().find((c) => c.verdict === "fail");
    if (!first)
      throw new FrameShrinkError(
        "Validator failed without an evidenced rule: " + message,
      );
    fp = fingerprint(first, message, frameIds, profile);
  }
  const after = await call("eth_getBlockByNumber", ["latest", false]);
  if (after.hash !== profile.headHash)
    throw new FrameShrinkError("State drift after simulation");
  return {
    status: fp ? "rejected" : "accepted",
    fingerprint: fp,
    raw,
    frameIds,
    checks: collector.toChecks(),
    simulation,
    message,
    bytes: (raw.length - 2) / 2,
  };
}
