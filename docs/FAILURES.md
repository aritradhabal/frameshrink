# Failure catalogue

These are failure families, not an exhaustive list of application errors. The public wizard supports five controlled choices: TIMESTAMP, NUMBER, a fixed application revert, a read-only SSTORE violation, and undeployed-owner EXTCODESIZE access. Gas-budget reduction remains available as a local fixture. Support for one controlled case does not imply support for every subcase in its family.

| Family | Stage | Example | Reducer support |
|---|---|---|---|
| Malformed input or encoding | request | Invalid JSON/RLP, malformed address, bad flag or oversized frame list | not supported |
| Wrong chain | protocol | Transaction chain ID differs from the execution client | not supported |
| Invalid nonce or keyed-nonce domain | protocol | Stale sequence, invalid/unsorted nonce keys, incompatible pending nonce | not supported |
| Invalid signature | authorization | Wrong signer or digest, malformed signature, edited transaction not re-signed | not supported |
| Invalid validation prefix or approval | validation | Unrecognized order of frames, missing execution/payment APPROVE | not supported |
| Forbidden frame structure | validation | Atomic flag in validation prefix, VERIFY after the prefix, invalid deployment arrangement | not supported |
| Expired validation condition | validation | An expiry verifier or application deadline has passed | not supported |
| Unusable recent-root reference | protocol/validation | Reference is too new, expired, not committed, or otherwise unusable | not supported |
| Declared gas budget exceeds policy | policy | Pinned local prefix gas plus signature cost exceeds its 100,000 limit; other node profiles may differ | owned verify-gas fixture supported |
| Actual out-of-gas or resource exhaustion | execution | A frame runs out of allocated execution/state gas; differs from a declared-budget rejection | not supported |
| Insufficient funds or unacceptable fees | solvency/admission | Payer cannot cover maximum cost, fee cap below the applicable base fee, insufficient payment value | not supported |
| Forbidden validation opcode | policy | TIMESTAMP or NUMBER is used in a validation context where the pinned policy forbids it | owned TIMESTAMP/NUMBER fixtures supported |
| Forbidden storage access or static write | policy | Unstaked payer reads a restricted slot, or a read-only validation frame attempts a state write | owned static SSTORE fixture supported; other storage cases not supported |
| Forbidden creation, call, or code access | policy | Disallowed CREATE/CREATE2, nested value-bearing validation call, missing contract code, or ENTRY_POINT code access | owned undeployed-owner EXTCODESIZE fixture supported; other call/code cases not supported |
| Stake, reputation, or local admission restriction | policy/mempool | Required stake/delay absent, entity banned or throttled, conflicting pending entries or node capacity rules | not supported |
| Application-defined revert | validation/execution | Stale proof generation, invalid Merkle proof, expired app authorization, quota exceeded, slippage, custom Solidity error or panic; unbounded possible messages | owned FrameShrinkFixtureFailure revert supported; arbitrary application reverts not supported |
| Execution body or atomic batch failure | execution | A transfer/swap body frame reverts; an atomic group rolls back according to the runtime semantics | not supported |
| Duplicate or invalid replacement | mempool | Transaction already known, replacement fee increase too small, nonce-key overlap conflict | not supported |
| Admitted transaction later becomes unusable | lifecycle | State, fees, root, nonce or reputation changes; request is dropped or stays pending without inclusion | not supported |
| Infrastructure or incomplete evidence | tool/client | RPC timeout, method unavailable, client crash, missing/misaligned trace, missing history or version mismatch; these do not establish a transaction-policy failure | inconclusive; never accepted as a preserving edit |

Several failures can coexist; each debug stage preserves its own fingerprint. Controlled revert/static-write fixtures require exact structured halt evidence; other missing traces and timeouts remain inconclusive. Public admission, successful execution and finality are distinct outcomes.

Rules, exemptions and thresholds depend on the mempool/client profile. Arbitrary application replay still requires captured setup and an adapter. Run `frameshrink failures` or `frameshrink failures --json`.

Sources: [pinned sidecar rule IDs](https://github.com/forshtat/mempool-workshop-sidecar/blob/2e22ff0a2898e69ea4bf5275bce1be8581a8582a/packages/types/src/explorer/index.ts), [upstream rule families](https://docs.altmempool.wtf/rules/).
