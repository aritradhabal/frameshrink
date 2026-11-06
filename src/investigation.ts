import { mkdir, readFile, writeFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { decodeAbiParameters, keccak256, type Hex } from "viem";
import { z } from "zod";
import {
  DATA_DIRECTORY,
  FrameShrinkError,
  bytesHash,
  saveJSON,
} from "./shared.js";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const ENDPOINTS = new Set([
  "https://altmempool.forshtat.com/rpc",
  "https://altmempoolgateway.forshtat.com/rpc",
]);
const METHODS = new Set([
  "skandha_explorer_info",
  "skandha_explorer_getTransaction",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_getBalance",
  "eth_getTransactionCount",
]);
export type Source = { hash: string; endpoint: string; explorer: string };
export function parseExplorerLink(input: string): Source {
  try {
    if (input.length > 2048) throw Error("Link exceeds 2048 characters");
    const url = new URL(input);
    if (
      url.origin !== "https://explorer.altmempool.wtf" ||
      url.username ||
      url.password ||
      url.hash
    )
      throw Error("Use an HTTPS explorer.altmempool.wtf transaction link");
    const match = /^\/tx\/(0x[0-9a-fA-F]{64})\/?$/.exec(url.pathname);
    if (
      !match ||
      url.searchParams.getAll("node").length !== 1 ||
      [...url.searchParams.keys()].some((k) => k !== "node")
    )
      throw Error(
        "Link must contain a transaction hash and exactly one node parameter",
      );
    const node = new URL(url.searchParams.get("node")!);
    if (node.username || node.password || node.search || node.hash)
      throw Error("RPC credentials and extra URL fields are not supported");
    const endpoint = node.href.replace(/\/$/, "");
    if (!ENDPOINTS.has(endpoint))
      throw Error("Only the two known sponsor RPC endpoints are supported");
    const hash = match[1].toLowerCase();
    return {
      hash,
      endpoint,
      explorer: `https://explorer.altmempool.wtf/tx/${hash}?node=${encodeURIComponent(endpoint)}`,
    };
  } catch (e) {
    throw new FrameShrinkError(
      `Invalid explorer link: ${(e as Error).message}`,
      2,
    );
  }
}
export type Observation =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: number; message: string } };
export type RpcRead = (
  endpoint: string,
  method: string,
  params: unknown[],
) => Promise<Observation>;
export const readRpc: RpcRead = async (endpoint, method, params) => {
  if (!ENDPOINTS.has(endpoint) || !METHODS.has(method))
    throw new FrameShrinkError(
      "Investigation RPC endpoint/method not allowed",
      3,
    );
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw Error("Empty HTTP response");
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw Error("RPC response exceeds 4 MiB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.jsonrpc !== "2.0" || data.id !== 1)
      throw Error("Malformed JSON-RPC envelope");
    if (data.error)
      return {
        ok: false,
        error: {
          ...(typeof data.error.code === "number"
            ? { code: data.error.code }
            : {}),
          message: String(data.error.message).slice(0, 2048),
        },
      };
    if (!("result" in data)) throw Error("Missing RPC result");
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } };
  }
};
const value = (o: Observation): any => (o.ok ? o.result : null);
const Quantity = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .max(66);
const HexData = z.string().regex(HEX).max(524288);
const FrameSchema = z
  .object({
    mode: z.number().int().min(0).max(2),
    flags: z.number().int().min(0).max(7),
    target: z.string().regex(ADDRESS).nullable(),
    limits: z.object({ execution: Quantity, state: Quantity }),
    value: Quantity,
    data: HexData,
  })
  .passthrough();
const CheckSchema = z
  .object({
    rule: z.string().max(80),
    verdict: z.enum(["pass", "fail", "skipped"]),
    detail: z.string().max(4096).optional(),
    frameIndex: z.number().int().min(0).max(63).optional(),
    entity: z.string().max(40).optional(),
  })
  .passthrough();
const DetailSchema = z
  .object({
    hash: z.string().regex(HASH),
    entry: z.record(z.string(), z.unknown()).nullable(),
    admission: z
      .object({
        txHash: z.string().regex(HASH),
        sender: z.string().regex(ADDRESS),
        outcome: z.enum([
          "rejected",
          "accepted",
          "included",
          "replaced",
          "dropped",
        ]),
        at: z.number().int().nonnegative(),
        checks: z.array(CheckSchema).max(1024),
        frames: z.array(FrameSchema).max(64).optional(),
      })
      .passthrough()
      .nullable(),
    events: z.array(z.unknown()).max(10000),
  })
  .passthrough();
export type Failure = {
  rule: string;
  detail: string;
  frameIndex: number | null;
  entity: string | null;
  decodedError: { type: string; message: string } | null;
};
export function decodeRevert(detail: string): Failure["decodedError"] {
  const match = /reverted with data (0x[0-9a-fA-F]+)(?:\s|$)/.exec(detail);
  if (
    !match ||
    match[1].length < 10 ||
    match[1].length > 8192 ||
    !HEX.test(match[1])
  )
    return null;
  const data = match[1];
  try {
    if (data.slice(0, 10).toLowerCase() === "0x08c379a0") {
      const [message] = decodeAbiParameters(
        [{ type: "string" }],
        `0x${data.slice(10)}`,
      );
      return { type: "Error(string)", message: message.slice(0, 2048) };
    }
    if (data.slice(0, 10).toLowerCase() === "0x4e487b71") {
      const [code] = decodeAbiParameters(
        [{ type: "uint256" }],
        `0x${data.slice(10)}`,
      );
      return {
        type: "Panic(uint256)",
        message: `Panic code 0x${code.toString(16)}`,
      };
    }
    return {
      type: "custom-error-selector",
      message: `${data.slice(0, 10)} (ABI required; name unknown)`,
    };
  } catch {
    return null;
  }
}
export type Investigation = {
  schemaVersion: 1;
  kind: "frameshrink-investigation";
  source: Source;
  capturedAt: string;
  status: "diagnosed" | "record-unavailable";
  outcome: string;
  frameCount: number;
  failures: Failure[];
  node: {
    chainId: string | null;
    version: string | null;
    commit: string | null;
    bootId: string | null;
    stableDuringCapture: boolean;
  };
  availability: {
    signedTransaction: boolean;
    frameDescriptions: boolean;
    historicalPrestate: false;
    originalPolicySnapshot: false;
    ownedSigningRecipe: false;
  };
  currentState: {
    blockNumber: string;
    blockHash: string;
    historicalRejectionState: false;
    accounts: Record<
      string,
      {
        code?: string;
        codeHash?: string;
        balance?: string;
        nonce?: string;
        errors: string[];
      }
    >;
    omittedAccounts: number;
    stableHeadDuringCapture: boolean;
  } | null;
  reproducibility: {
    status: "diagnostic-only";
    missing: string[];
    supportedOwnedAnalogue: string | null;
  };
  interpretation: {
    observed: string;
    inference: string | null;
    nextSteps: string[];
  };
  raw: Record<string, Observation>;
};
export async function investigate(
  source: Source,
  rpc: RpcRead = readRpc,
): Promise<Investigation> {
  // Revalidate even library callers, so the network reader never follows an arbitrary URL.
  const verified = parseExplorerLink(source.explorer);
  if (verified.hash !== source.hash || verified.endpoint !== source.endpoint)
    throw new FrameShrinkError("Inconsistent source metadata", 2);
  const raw: Record<string, Observation> = {};
  const specs: [string, string, unknown[]][] = [
    ["infoBefore", "skandha_explorer_info", []],
    ["detail", "skandha_explorer_getTransaction", [source.hash]],
    ["chainId", "eth_chainId", []],
    ["headBefore", "eth_getBlockByNumber", ["latest", false]],
    ["chainTransaction", "eth_getTransactionByHash", [source.hash]],
  ];
  const results = await Promise.allSettled(
    specs.map(async ([key, method, params]) => {
      raw[key] = await rpc(source.endpoint, method, params);
    }),
  );
  for (const [i, result] of results.entries())
    if (result.status === "rejected")
      raw[specs[i][0]] = {
        ok: false,
        error: { message: String(result.reason) },
      };
  const info = value(raw.infoBefore);
  if (info?.protocolVersion !== undefined && info.protocolVersion !== 1)
    throw new FrameShrinkError("Unsupported explorer protocol version", 3);
  const parsed = DetailSchema.safeParse(value(raw.detail));
  if (raw.detail.ok && !parsed.success)
    throw new FrameShrinkError("Malformed explorer transaction detail", 4);
  const detail = parsed.success ? parsed.data : null;
  if (
    detail &&
    (detail.hash.toLowerCase() !== source.hash ||
      (detail.admission &&
        detail.admission.txHash.toLowerCase() !== source.hash))
  )
    throw new FrameShrinkError(
      "Explorer returned another transaction's evidence",
      4,
    );
  const admission = detail?.admission;
  const failures: Failure[] = (admission?.checks ?? [])
    .filter((c) => c.verdict === "fail")
    .map((c) => {
      const explicit = /validation frame (\d+):/.exec(c.detail ?? "");
      const frameIndex =
        c.frameIndex ?? (explicit ? Number(explicit[1]) : null);
      return {
        rule: c.rule,
        detail: c.detail ?? "No detail supplied",
        frameIndex,
        entity: c.entity ?? null,
        decodedError: decodeRevert(c.detail ?? ""),
      };
    });
  const tx = (detail?.entry as any)?.tx ?? value(raw.chainTransaction);
  // Presence is reported separately from validity; no imported payload is signed or executed here.
  const signedTransaction = !!(
    tx &&
    typeof tx === "object" &&
    typeof tx.sender === "string" &&
    Array.isArray(tx.frames) &&
    Array.isArray(tx.signatures) &&
    tx.fees &&
    tx.chainId !== undefined
  );
  const frames = admission?.frames ?? [];
  const head = value(raw.headBefore);
  let currentState: Investigation["currentState"] = null;
  if (
    head &&
    typeof head.number === "string" &&
    /^0x[0-9a-f]+$/i.test(head.number) &&
    typeof head.hash === "string" &&
    HASH.test(head.hash)
  ) {
    const addresses = [
      ...new Set(
        [admission?.sender, ...frames.map((f) => f.target)]
          .filter((a): a is string => typeof a === "string" && ADDRESS.test(a))
          .map((a) => a.toLowerCase()),
      ),
    ];
    const accounts: NonNullable<Investigation["currentState"]>["accounts"] = {};
    // Bounded reads at one explicit observation block. These are NOT the historical prestate.
    for (const address of addresses.slice(0, 8)) {
      const observations = await Promise.allSettled(
        ["eth_getCode", "eth_getBalance", "eth_getTransactionCount"].map(
          async (method) => {
            const observed = await rpc(source.endpoint, method, [
              address,
              head.number,
            ]);
            raw[`${address}:${method}`] = observed;
            return { method, observed };
          },
        ),
      );
      const account: NonNullable<
        Investigation["currentState"]
      >["accounts"][string] = { errors: [] };
      for (const observation of observations) {
        if (observation.status === "rejected") {
          account.errors.push(String(observation.reason));
          continue;
        }
        const { method, observed } = observation.value;
        if (!observed.ok) {
          account.errors.push(`${method}: ${observed.error.message}`);
          continue;
        }
        if (typeof observed.result !== "string") {
          account.errors.push(`${method}: malformed response`);
          continue;
        }
        if (method === "eth_getCode" && HEX.test(observed.result)) {
          account.code = observed.result;
          account.codeHash = keccak256(observed.result as Hex);
        } else if (
          method !== "eth_getCode" &&
          /^0x[0-9a-f]+$/i.test(observed.result)
        ) {
          if (method === "eth_getBalance") account.balance = observed.result;
          else if (method === "eth_getTransactionCount")
            account.nonce = observed.result;
        } else account.errors.push(`${method}: malformed response`);
      }
      accounts[address] = account;
    }
    raw.headAfter = await rpc(source.endpoint, "eth_getBlockByNumber", [
      head.number,
      false,
    ]);
    currentState = {
      blockNumber: head.number,
      blockHash: head.hash,
      historicalRejectionState: false,
      accounts,
      omittedAccounts: Math.max(0, addresses.length - 8),
      stableHeadDuringCapture: value(raw.headAfter)?.hash === head.hash,
    };
  }
  raw.infoAfter = await rpc(source.endpoint, "skandha_explorer_info", []);
  const after = value(raw.infoAfter);
  const stable =
    typeof info?.bootId === "string" &&
    after?.bootId === info.bootId &&
    after?.protocolVersion === info.protocolVersion;
  const missing = [
    ...(!signedTransaction
      ? [
          "Complete signed transaction (explorer entry and chain lookup do not supply it)",
        ]
      : []),
    "Historical pre-rejection chain state, including required storage and root/proof context",
    "Exact original client/sidecar builds and admission policy/stake/reputation snapshot",
    "Owned rebuild recipe and authorization to re-sign edited candidates",
  ];
  if (!stable) missing.push("Consistent explorer boot identity during capture");
  if (currentState && !currentState.stableHeadDuringCapture)
    missing.push("Stable observed block hash during account reads");
  const reasons = failures
    .map((f) => f.decodedError?.message ?? f.detail)
    .join("; ");
  const staleRoot = failures.some((f) =>
    f.decodedError?.message.includes("root from an old generation"),
  );
  const analogue = /MAX_VERIFY_GAS/.test(reasons)
    ? "fixtures/verify-gas.json"
    : /TIMESTAMP|BannedOpcode\(66\)/.test(reasons)
      ? "fixtures/banned-opcode.json"
      : null;
  return {
    schemaVersion: 1,
    kind: "frameshrink-investigation",
    source,
    capturedAt: new Date().toISOString(),
    status: detail ? "diagnosed" : "record-unavailable",
    outcome: admission?.outcome ?? "unknown",
    frameCount: frames.length,
    failures,
    node: {
      chainId:
        typeof value(raw.chainId) === "string" ? value(raw.chainId) : null,
      version: typeof info?.version === "string" ? info.version : null,
      commit:
        typeof info?.commit === "string" && info.commit ? info.commit : null,
      bootId: typeof info?.bootId === "string" ? info.bootId : null,
      stableDuringCapture: stable,
    },
    availability: {
      signedTransaction,
      frameDescriptions: frames.length > 0,
      historicalPrestate: false,
      originalPolicySnapshot: false,
      ownedSigningRecipe: false,
    },
    currentState,
    reproducibility: {
      status: "diagnostic-only",
      missing,
      supportedOwnedAnalogue: analogue,
    },
    interpretation: {
      observed:
        reasons ||
        (detail
          ? "No failing rule retained in this record"
          : "Node does not supply the requested explorer record"),
      inference: staleRoot
        ? "The application validator appears to reject an outdated proof/root generation. Contract code and historical storage are needed to confirm the mechanism. This error string does not establish an EIP-8272 recent-root failure."
        : null,
      nextSteps: staleRoot
        ? [
            "Obtain the validator source/ABI, proof-generation inputs and accepted root-generation state from the application developer",
            "Reproduce the unchanged validation revert in an owned, matching local setup",
            "If the source confirms a stale proof, regenerate the proof/witness for an accepted generation; rebuild and re-sign, then verify the corrected control",
            "Add an application-specific recipe and exact revert predicate before enabling reduction; this release does not minimize arbitrary validation reverts",
          ]
        : [
            "Preserve this capture before explorer history expires",
            "Obtain the missing replay artifacts from the submitting developer or an admission-time capture hook",
            ...(analogue
              ? [
                  `Use ${analogue} for an owned analogue of the failure class, explicitly distinct from historical replay`,
                ]
              : [
                  "Add a supported owned recipe for this failure before enabling reduction",
                ]),
          ],
    },
    raw,
  };
}
const clean = (s: string) =>
  s.replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
export function formatInvestigation(
  report: Investigation,
  directory?: string,
): string {
  return [
    "FrameShrink · explorer investigation",
    `Transaction: ${report.source.hash}`,
    `Node: ${report.source.endpoint}`,
    `Observed outcome: ${report.outcome} · ${report.frameCount} retained frames`,
    "",
    ...report.failures.flatMap((f) => [
      `Failure: ${clean(f.rule)}${f.frameIndex === null ? "" : ` · frame ${f.frameIndex}`}`,
      `  ${clean(f.decodedError ? `${f.decodedError.type}: ${f.decodedError.message}` : f.detail)}`,
    ]),
    ...(!report.failures.length ? [clean(report.interpretation.observed)] : []),
    "",
    `Signed transaction: ${report.availability.signedTransaction ? "available as reported; validity not checked" : "unavailable"}`,
    `Current account data: ${report.currentState ? `${Object.keys(report.currentState.accounts).length} account(s) at block ${report.currentState.blockNumber}; NOT original rejection state` : "unavailable"}`,
    `Reproduction: ${report.reproducibility.status}`,
    "Missing:",
    ...report.reproducibility.missing.map((s) => `  - ${clean(s)}`),
    ...(report.interpretation.inference
      ? ["", `Inference: ${clean(report.interpretation.inference)}`]
      : []),
    "",
    "Next steps:",
    ...report.interpretation.nextSteps.map((s, i) => `  ${i + 1}. ${clean(s)}`),
    ...(directory
      ? [
          "",
          `Evidence saved: ${directory}`,
          `Offline report: frameshrink explain ${JSON.stringify(directory)}`,
        ]
      : []),
  ].join("\n");
}
const FILES = [
  "report.json",
  "rpc-evidence.json",
  "observed-state.json",
  "README.txt",
];
export async function exportInvestigation(
  report: Investigation,
  directory: string,
) {
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const { raw, ...summary } = report;
  await saveJSON(path.join(directory, "report.json"), summary);
  await saveJSON(path.join(directory, "rpc-evidence.json"), raw);
  await saveJSON(
    path.join(directory, "observed-state.json"),
    report.currentState,
  );
  await writeFile(
    path.join(directory, "README.txt"),
    formatInvestigation(report) +
      "\n\nCaptured read-only evidence, not a portable regression fixture. Latest-observed code/balance/nonce do not reconstruct original storage or policy. No signing, simulation or submission was performed. Checksums detect modifications; they are not a third-party authenticity proof.\n",
  );
  const checksums: Record<string, string> = {};
  for (const file of FILES)
    checksums[file] = bytesHash(await readFile(path.join(directory, file)));
  await saveJSON(path.join(directory, "manifest.json"), {
    schemaVersion: 1,
    kind: "frameshrink-investigation",
    reproductionStatus: "diagnostic-only",
    checksums,
  });
}
export async function loadInvestigation(
  directory: string,
): Promise<Investigation> {
  const entries = await readdir(directory);
  if (
    entries.length !== FILES.length + 1 ||
    entries.some((f) => f !== "manifest.json" && !FILES.includes(f))
  )
    throw new FrameShrinkError("Unexpected investigation files", 2);
  for (const file of entries) {
    const stat = await lstat(path.join(directory, file));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 40 * 1024 * 1024)
      throw new FrameShrinkError(
        "Investigation entries must be bounded regular files",
        2,
      );
  }
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "frameshrink-investigation" ||
    Object.keys(manifest.checksums ?? {})
      .sort()
      .join() !== [...FILES].sort().join()
  )
    throw new FrameShrinkError("Invalid investigation manifest", 2);
  for (const file of FILES)
    if (
      bytesHash(await readFile(path.join(directory, file))) !==
      manifest.checksums[file]
    )
      throw new FrameShrinkError(`Investigation checksum mismatch: ${file}`, 5);
  const summary = JSON.parse(
    await readFile(path.join(directory, "report.json"), "utf8"),
  );
  const raw = JSON.parse(
    await readFile(path.join(directory, "rpc-evidence.json"), "utf8"),
  );
  const restored = z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("frameshrink-investigation"),
      source: z.object({
        hash: z.string().regex(HASH),
        endpoint: z.string().max(2048),
        explorer: z.string().max(2048),
      }),
      capturedAt: z.string().max(80),
      status: z.enum(["diagnosed", "record-unavailable"]),
      outcome: z.string().max(40),
      frameCount: z.number().int().min(0).max(64),
      failures: z
        .array(
          z.object({
            rule: z.string().max(80),
            detail: z.string().max(4096),
            frameIndex: z.number().int().min(0).max(63).nullable(),
            entity: z.string().max(40).nullable(),
            decodedError: z
              .object({
                type: z.string().max(80),
                message: z.string().max(2048),
              })
              .nullable(),
          }),
        )
        .max(1024),
      availability: z.object({
        signedTransaction: z.boolean(),
        frameDescriptions: z.boolean(),
        historicalPrestate: z.literal(false),
        originalPolicySnapshot: z.literal(false),
        ownedSigningRecipe: z.literal(false),
      }),
      currentState: z
        .object({
          blockNumber: Quantity,
          blockHash: z.string().regex(HASH),
          historicalRejectionState: z.literal(false),
          accounts: z.record(z.string().regex(ADDRESS), z.unknown()),
          omittedAccounts: z.number().int().nonnegative(),
          stableHeadDuringCapture: z.boolean(),
        })
        .nullable(),
      reproducibility: z.object({
        status: z.literal("diagnostic-only"),
        missing: z.array(z.string().max(4096)).max(100),
        supportedOwnedAnalogue: z.string().max(256).nullable(),
      }),
      interpretation: z.object({
        observed: z.string().max(1048576),
        inference: z.string().max(4096).nullable(),
        nextSteps: z.array(z.string().max(4096)).max(100),
      }),
    })
    .passthrough()
    .safeParse(summary);
  if (!restored.success)
    throw new FrameShrinkError("Invalid investigation report", 2);
  const source = parseExplorerLink(restored.data.source.explorer);
  if (
    source.hash !== restored.data.source.hash ||
    source.endpoint !== restored.data.source.endpoint
  )
    throw new FrameShrinkError("Inconsistent offline source metadata", 2);
  return { ...summary, raw };
}
export const defaultCaseDirectory = (source: Source) =>
  path.join(
    DATA_DIRECTORY,
    "cases",
    `${source.hash.slice(2, 14)}-${Date.now()}`,
  );
