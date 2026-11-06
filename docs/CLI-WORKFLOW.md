# FrameShrink CLI: from explorer link to a regression case

The product goal is to turn an alt-mempool failure into a small, shareable regression case a developer can reproduce with one command. Explorer import is the first step. It does not recreate missing state merely from a transaction hash.

## Interactive transaction wizard

```sh
frameshrink start transaction
frameshrink start transaction --out .runs/my-demo
```

Use arrows to navigate, space to select failures, and Enter to continue. The wizard offers CLI-created wallets, secure named wallet creation, faucet funding or an address/explorer link, and a combined/separate transaction choice on every run. It does not import external private keys. Legacy `wallet`/`whoami` commands retain their default wallet; a wizard selection is scoped to its run.

Supported controlled fixtures cover five choices: an explicit `FrameShrinkFixtureFailure()` revert, SSTORE attempted during read-only validation, TIMESTAMP, NUMBER, and EXTCODESIZE on the captured undeployed owner. The three new categories use the v3 owner-bound validator; opcode-only selections reuse v2. Existing deployments and regression cases remain available. Other catalogue entries are disabled; the gas-budget fixture remains local-only because the public node's policy differed in the earlier probe. TIMESTAMP and NUMBER are two violations within one policy family; the new fixtures cover three additional categories, each with a specific supported case.

There are explicit confirmations before deployment (0.01 devnet ETH plus bounded gas), each failing submission and each corrected submission. Separate cases run sequentially to capture the current nonce after the preceding correction. In a combined transaction, admission may report only the first forbidden opcode. Local debugging preserves each current fingerprint while shrinking, disables that failing branch, reproduces and reduces the next failure, and checks the all-fixed control. Execution-halting branches run before policy-only violations. Only original failures and final corrections are sent publicly. The debug picker offers 80 or 20 evaluations per failure; intermediate corrections are local evidence.

The terminal-only diff shows frame/byte reduction and each skipped opcode. It does not claim arbitrary program repair: this owned fixture exposes explicit test-mode branches. The export includes all signed debug stages, initial state, pinned profile, deployment and public rejection/receipt evidence. Checksummed replay needs no signing key.

```sh
frameshrink start debug /absolute/path/to/case
```

Use this after saving before debugging or declining the correction. It finds the case's CLI wallet, verifies the saved artifacts/profile and continues without resending the original failure. If that validator's nonce has since changed, correction submission stops. Ctrl-C cancels prompts cleanly; verified rejected/reduced cases remain resumable. Cancelling before the original submission leaves a prepared artifact only; start a new run to send a new case. Exiting during a separate-case sequence stops that sequence; resume the printed case and start another run for remaining choices.

A receipt can be pending after the bounded wait; the wizard offers Check again or Save & exit. A cancelled relayer submission is reported as inconclusive with its reason and stops the sequence. `frameshrink demo resume <case>` checks the known correction hash without sending again. Unknown submission outcomes stop rather than being called a rejection. The wizard requires a TTY and does not support `--json`; `--no-color` and `NO_COLOR` apply to its prompts and diff.

## Working today

After `npm ci` and `npm run bootstrap`, run `npm link` once to install the local `frameshrink` executable. It is a link to this checkout, not a package published to npm. You can also run `./bin/frameshrink.mjs` without linking.

```sh
frameshrink debug 'https://explorer.altmempool.wtf/tx/0xf5b65c96057977aaab766eb055520a001b22662c8dffef555068e7e56899ef09?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc'
```

`debug` reads the selected sponsor RPC, decodes standard Solidity errors, identifies the reported failure stage/frame, checks whether the signed transaction is available, and collects available code, code hashes, balances and nonces for up to eight referenced accounts at an explicit observation block. It checks the block hash and explorer boot identity around capture. It performs no signing, transaction submission or simulation.

The default export is a new directory under the data directory’s `cases/` folder (`.runs/cases/` in a checkout, `~/.frameshrink/cases/` when installed). `--out <new-directory>` selects another destination; existing directories are not overwritten. `--json` produces machine-readable output. Cases contain the report, raw RPC responses, observed account data, a plain-text explanation and checksums. Only the two known sponsor endpoints are accepted; URL credentials, arbitrary endpoints and redirects are refused.

```sh
frameshrink explain /absolute/path/to/saved-case
frameshrink explain /absolute/path/to/saved-case --json
```

`explain` verifies checksums and works offline. An expired or unavailable explorer record is reported explicitly; `debug` preserves the evidence and exits 3. A successful diagnostic capture exits 0 even when the observed transaction was rejected. A diagnostic case cannot enter regression replay: `replay` explains the missing artifacts and exits 3 before restarting the runtime.

## What the supplied link actually shows

The live node retained four frame descriptions and a `simulation` failure identifying validation frame 0. The revert bytes decode to:

```text
Error(string): AnonAI: root from an old generation
```

The full mempool transaction entry is null; the chain lookup also returns null. Current data for three referenced accounts was captured at block `0x11a7` (4519). This is not the original rejection state. The report is therefore **diagnostic-only**.

The application appears to reject a stale proof/root generation, but the error string alone does not prove the internal mechanism. It does not establish an EIP-8272 recent-root failure. The developer needs the validator source/ABI, proof inputs and relevant historical generation/storage state. Changing a root identifier alone is not a substitute for regenerating a valid proof and authorization.

This specific arbitrary validation revert is not supported by the current reducer. Neither our gas-budget nor our banned-opcode fixture is a replay of this transaction.

## Unified owned-case workflow

| Step | Developer result | Current capability |
|---|---|---|
| Capture | Preserve the rejection report before it expires | Implemented for explorer URLs |
| Diagnose | See stage, frame, decoded error and evidence | Implemented; explanations beyond observed data are marked as inference |
| Establish reproduction | Recreate the same failure under known state and policy | Implemented for owned supported fixtures; arbitrary explorer cases require missing artifacts and a recipe adapter |
| Minimize | Remove irrelevant calls/data without changing the predicate | Implemented for owned local gas-budget and captured TIMESTAMP/NUMBER fixtures |
| Package | Share setup, signatures, raw reports and expected predicate | Implemented for supported regression bundles |
| Verify a fix | Original still reproduces; corrected control passes | Implemented for supported fixtures; arbitrary application fixes require their own controls |

A useful next integration is an admission-time capture helper in the submitting developer's workflow. It should retain the exact payload and simulation block, versioned policy/stake/reputation inputs, required prestate/contract setup and an owned fixture/signing adapter when the failure happens. This avoids trying to recover expired information later. A block reference alone is insufficient without archive state or reconstructible setup.

The complete raw state of an arbitrary application is not generally recoverable from the explorer report. A safe tool should name that gap, not substitute today's chain state and call it a historical replay.

## Event fit and demonstration

The [Ethereum Foundation bounty](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation) explicitly includes developer tooling, admission simulation and monitoring. A CLI is an appropriate interface. The qualification requirement is actual alt-mempool usage, evidenced by an admitted transaction or submission code, plus the team's understanding of the implementation and trade-offs. The saved successful public proof and submission code are separate from URL diagnosis.

A strong demo is: paste the explorer link → show the decoded error and reproduction checklist → run an owned fully captured case through reduction and clean replay → show its passing control and separate real public admission/execution evidence. Label which steps concern the same case and which concern another supported example. A URL wrapper alone would not demonstrate our reduction novelty.

The [event rules](https://ethglobal.com/events/mumbai/info/details) separately govern pre-existing designs/assets, track eligibility, AI attribution, meaningful team contributions and version history. CLI format does not settle those eligibility questions. Preserve dated provenance and disclose the actual work; do not manufacture commit history or imply advance assets were created during the event.

## Active test wallet and faucet

```sh
frameshrink wallet create
frameshrink whoami
frameshrink wallet status
frameshrink wallet faucet
frameshrink failures
```

`wallet create` creates one local EOA signing identity, or reuses the existing one. `whoami` and `wallet status` show its public address, sponsor chain 1337 and observed balance. Add `--offline` to avoid RPC reads; all commands support `--json`. This is a selected local development identity, not authentication to the explorer website and not a deployed smart-contract wallet. `demo run` now deploys/reuses the owner-bound conditional-TIMESTAMP validator and connects its captured-state adapter. The older public-proof script retains its own separate test identity; changing the active wallet does not alter its saved evidence.

The generated key is stored unencrypted inside the private `.runs/wallet` directory (0700), in a 0600 key file. It is never printed or included in status, case reports or source archives. Insecure permissions, symlinked key storage and corrupted wallet files are refused rather than silently replacing the account. This is a development-only wallet, not a production keystore.

`wallet faucet` verifies the known sponsor node's chain/protocol and faucet availability, records the attempt before dispatch, and requests funds for the selected address only. A successful request is not called funded until a matching successful transfer receipt is observed. Pending requests are polled on a later invocation; timeouts with unknown outcomes are not blindly resubmitted. An included transfer is not a claim of finality. A local one-hour cooldown prevents repeated requests for the same account; server-wide limits and faucet availability also apply.

The wallet flow was tested live: address `0xebF00143AC1A763922A65b887e2d1B66233eFDaB`, observed balance **1 devnet ETH**, successful faucet transaction `0x84f3c98634786265ee60f83760c65d3e2961c819f1e4a86268433d01b567a8df`. Public evidence is saved in `evidence/devnet-wallet.json`; private key material remains excluded.

## Automatic single-case flow

`frameshrink demo run` performs the full owned-validator case from the active wallet. It is an intentional testnet write operation, not part of unit tests, browser startup or URL import. The first run deploys the fixed validator and funds it with 0.01 devnet ETH. Later runs reuse the same validator while capturing its current nonce/balance. Its bytecode checks SIGPARAM signer, scheme and canonical-message metadata against the embedded owner before approving execution/payment. The failing input executes TIMESTAMP; the corrected input branches around it.

The workflow stores the exact original signed payload before submitting it. It requires both a matching rejection response and a retained rejected admission report for TIMESTAMP. Reduction uses the same signed baseline and re-signs edits locally. A second clean runner asserts the original/reduced failure fingerprint and passing correction without any signing key. The corrected reduced payload is then submitted once to the auto-bundling primary; success requires a matching accepted/included admission and successful per-frame receipt.

A missing or uncertain response stops the workflow rather than fabricating success. Known pending correction hashes can be reconciled with `demo resume`; that command does not resend. Deployment attempts are also recorded before dispatch and never blindly replaced. All raw evidence is saved in the case. The fixed signer permits bounded sponsor-chain frames with zero-value body calls only to the owner, and the fixed funded validator deployment; it does not expose arbitrary transaction signing.

The initial high-gas EOA attempt was accepted by the public node while the pinned local policy rejected it. That profile difference is retained in `evidence/public-profile-difference.json`; the tool stopped instead of treating acceptance as a rejection. The verified unified case uses the owner-bound TIMESTAMP validator.

The earlier single-failure case is `evidence/unified-demo`: rejected `0xb20cc4daaf82ccd0f8bfde27be1e65843c1a1e7b873859a297ae8cdaa61b73c5`, corrected `0x048c1d34c9bbc3a37bf222614fe4001f2717b30b814766efc1d3edaa999c8ed1`, 767 → 282 bytes, successful correction in block 5291. This is one owned case all the way through; arbitrary external explorer cases still require their missing artifacts.

`debug`/`explain` now show a short diagnosis by default; append `--verbose` for the complete missing-artifact checklist, inference and next steps. Noninteractive CLI output supports `--json`. Colors follow TTY/`FORCE_COLOR`, `NO_COLOR` and `--no-color`; machine JSON is never decorated.

## Frame and change previews

Before confirming the failing transaction, the wizard offers **O** to open the transaction in the configured editor or **C** to continue. Press Enter after the letter. It uses `VISUAL`, then `EDITOR`, then the system text editor (macOS) or associated-file opener. For Zed on this machine:

```sh
VISUAL='zed --wait' frameshrink start transaction
```

The preview includes frame indices and stable IDs, validation/execution mode, target, calldata and decoded arrays, execution/state gas limits, ETH value, chain/nonce/fees, signatures and the exact encoded payload. It is a read-only copy under the data directory’s `previews/` folder, outside the replay bundle. Edits to the preview never alter a signed transaction or the proposed correction. Close a waiting editor to return to the prompt; GUI editors without a wait flag return immediately.

After reduction, the terminal names removed frames, retained-call input changes and each validation-mode correction. The same O/C prompt opens a full change report with per-stage original/reduced/correction recipes, failure fingerprints and before/after decoded transactions. Every public submission still requires its separate default-no confirmation.

With `--verbose`, each reduction evaluation prints as it completes: stage/evaluation number, baseline/repeat/control or attempted edit, whether it reproduces the same failure, and encoded byte size. One evaluation runs a signed candidate through ethrex and policy checks. New edits are rebuilt and signed before evaluation; the repeat check reuses the exact baseline payload. Cached candidates do not count as new evaluations or appear as fresh simulations. The 80/20 choice is a maximum per selected failure, including baseline, repeat and passing-control checks; public capture and clean replay are additional verification steps. Candidates are never submitted publicly. Normal terminal output reuses one transient check row and retains the per-failure summaries; newly generated cases preserve all check events in checksum-covered `evaluation-log.json`.

The original rejected hash and explorer link appear immediately after public rejection capture, before debugging. The final transaction summary shows only the corrected hash/link and its actual public outcome. Admission rejection has an identifiable transaction hash/report but no successful block execution receipt.

## Expanded fixture categories

| Choice | Controlled failure | Correction |
|---|---|---|
| Application revert (test error) | Validation returns exact `FrameShrinkFixtureFailure()` selector `0x2e29a28b` | Disable the fixture revert branch |
| State write during validation | SSTORE in a VERIFY frame produces `static_violation` at frame 0 | Disable that state-write branch |
| Code access to an undeployed account | EXTCODESIZE reads the captured owner EOA, whose code is empty; pinned policy rejects it | Disable the forbidden code read |

These are adapters for owned, fixed test cases. They do not imply arbitrary custom-revert repair, generic storage minimization, or support for every CREATE/CALL/code-access restriction. The failed execution cases do not produce a completed execution trace; they require exact structured halt/frame evidence, an owner-bound v3 runtime, a valid canonical signature, repeat stability, and a separately passing control. Other missing traces remain inconclusive. A combined all-five fixture is diagnosed in this order: application revert → static write → TIMESTAMP → NUMBER → code access. Every stage has its own failure fingerprint and exact signed replay evidence.

Selecting any new category requires one v3 validator deployment per CLI wallet, funded with 0.01 devnet ETH plus deployment gas after confirmation. Existing v1/v2 records are retained. The fixed signer still permits only chain 1337, bounded gas/fees, no roots/blobs, and zero-value execution calls to the wallet owner.
