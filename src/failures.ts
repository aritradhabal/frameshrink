import { SIDECAR_COMMIT } from "./shared.js";
export const FAILURE_CATALOG = [
  {
    id: "wire-format",
    stage: "request",
    name: "Malformed input or encoding",
    example:
      "Invalid JSON/RLP, malformed address, bad flag or oversized frame list",
    reducer: "not supported",
  },
  {
    id: "chain",
    stage: "protocol",
    name: "Wrong chain",
    example: "Transaction chain ID differs from the execution client",
    reducer: "not supported",
  },
  {
    id: "nonce",
    stage: "protocol",
    name: "Invalid nonce or keyed-nonce domain",
    example:
      "Stale sequence, invalid/unsorted nonce keys, incompatible pending nonce",
    reducer: "not supported",
  },
  {
    id: "signature",
    stage: "authorization",
    name: "Invalid signature",
    example:
      "Wrong signer or digest, malformed signature, edited transaction not re-signed",
    reducer: "not supported",
  },
  {
    id: "prefix",
    stage: "validation",
    name: "Invalid validation prefix or approval",
    example: "Unrecognized order of frames, missing execution/payment APPROVE",
    reducer: "not supported",
  },
  {
    id: "structure",
    stage: "validation",
    name: "Forbidden frame structure",
    example:
      "Atomic flag in validation prefix, VERIFY after the prefix, invalid deployment arrangement",
    reducer: "not supported",
  },
  {
    id: "expiry",
    stage: "validation",
    name: "Expired validation condition",
    example: "An expiry verifier or application deadline has passed",
    reducer: "not supported",
  },
  {
    id: "recent-root",
    stage: "protocol/validation",
    name: "Unusable recent-root reference",
    example:
      "Reference is too new, expired, not committed, or otherwise unusable",
    reducer: "not supported",
  },
  {
    id: "budget",
    stage: "policy",
    name: "Declared gas budget exceeds policy",
    example:
      "Pinned local prefix gas plus signature cost exceeds its 100,000 limit; other node profiles may differ",
    reducer: "owned verify-gas fixture supported",
  },
  {
    id: "out-of-gas",
    stage: "execution",
    name: "Actual out-of-gas or resource exhaustion",
    example:
      "A frame runs out of allocated execution/state gas; differs from a declared-budget rejection",
    reducer: "not supported",
  },
  {
    id: "funding-fees",
    stage: "solvency/admission",
    name: "Insufficient funds or unacceptable fees",
    example:
      "Payer cannot cover maximum cost, fee cap below the applicable base fee, insufficient payment value",
    reducer: "not supported",
  },
  {
    id: "opcode",
    stage: "policy",
    name: "Forbidden validation opcode",
    example:
      "TIMESTAMP or NUMBER is used in a validation context where the pinned policy forbids it",
    reducer: "owned TIMESTAMP/NUMBER fixtures supported",
  },
  {
    id: "storage",
    stage: "validation/policy",
    name: "Forbidden storage access or static write",
    example:
      "Unstaked payer reads a restricted slot, or a read-only validation frame attempts a state write",
    reducer:
      "owned static SSTORE fixture supported; other storage cases not supported",
  },
  {
    id: "creation-calls-code",
    stage: "policy",
    name: "Forbidden creation, call, or code access",
    example:
      "Disallowed CREATE/CREATE2, nested value-bearing validation call, missing contract code, or ENTRY_POINT code access",
    reducer:
      "owned undeployed-owner EXTCODESIZE fixture supported; other call/code cases not supported",
  },
  {
    id: "stake-reputation",
    stage: "policy/mempool",
    name: "Stake, reputation, or local admission restriction",
    example:
      "Required stake/delay absent, entity banned or throttled, conflicting pending entries or node capacity rules",
    reducer: "not supported",
  },
  {
    id: "application-revert",
    stage: "validation/execution",
    name: "Application-defined revert",
    example:
      "Stale proof generation, invalid Merkle proof, expired app authorization, quota exceeded, slippage, custom Solidity error or panic; unbounded possible messages",
    reducer:
      "owned FrameShrinkFixtureFailure revert supported; arbitrary application reverts not supported",
  },
  {
    id: "body-revert",
    stage: "execution",
    name: "Execution body or atomic batch failure",
    example:
      "A transfer/swap body frame reverts; an atomic group rolls back according to the runtime semantics",
    reducer: "not supported",
  },
  {
    id: "replacement",
    stage: "mempool",
    name: "Duplicate or invalid replacement",
    example:
      "Transaction already known, replacement fee increase too small, nonce-key overlap conflict",
    reducer: "not supported",
  },
  {
    id: "revalidation",
    stage: "lifecycle",
    name: "Admitted transaction later becomes unusable",
    example:
      "State, fees, root, nonce or reputation changes; request is dropped or stays pending without inclusion",
    reducer: "not supported",
  },
  {
    id: "infrastructure",
    stage: "tool/client",
    name: "Infrastructure or incomplete evidence",
    example:
      "RPC timeout, method unavailable, client crash, missing/misaligned trace, missing history or version mismatch; these do not establish a transaction-policy failure",
    reducer: "inconclusive; never accepted as a preserving edit",
  },
] as const;
export function failuresReport() {
  return {
    schemaVersion: 1,
    profile: `Pinned sidecar ${SIDECAR_COMMIT}; taxonomy, not exhaustive contract messages or proof every draft rule is implemented`,
    families: FAILURE_CATALOG,
    notes: [
      "Several categories can apply to one request; a node may stop at the first failure.",
      "Reported IDs, thresholds and stake exemptions depend on the client/mempool profile.",
      "Accepted, pending, included, executed successfully and finalized are distinct outcomes.",
      "The explorer importer can retain observed reports for more families than the reducer can minimize.",
    ],
  };
}
export function failuresText() {
  return [
    "FrameShrink failure families",
    ...FAILURE_CATALOG.map(
      (f, i) =>
        `${i + 1}. ${f.name} [${f.stage}]\n   ${f.example}\n   Reduction: ${f.reducer}`,
    ),
    "",
    ...failuresReport().notes,
  ].join("\n");
}
