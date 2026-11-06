# Verification report

Prepared 6 November 2026. All outcomes below are observations from this build, not guarantees about future runtime or network behavior.

## Local implementation

| Check | Observed result |
|---|---|
| Fresh pinned dependency checkout and build | Passed; own `.vendor/sidecar`, no dependency on the research checkout |
| TypeScript strict type checking | Passed |
| Core/CLI/wallet/signing/wizard test suite | 42 passed, 0 failed |
| Real ethrex integration suite | 5 scenarios passed, including v2 combined TIMESTAMP → NUMBER → passing control: original fixture families, captured EOA and captured owner-bound validator; includes clean replay and canonical-authorization checks |
| Browser end-to-end suite | 1 scenario passed, covering both families, export/replay, invalid imports, mobile layout and request guards |
| Formatting | Passed |
| Root npm dependency audit | 0 known vulnerabilities at check time; inherited sidecar/client excluded from this audit scope |
| Original/reduced clean replay | Both families reproduced; corrected controls accepted |

The generated [browser report](../evidence/browser-results.json), [root audit](../evidence/npm-audit.json), [gas-family replay](../evidence/verify-gas-replay.json) and [opcode-family replay](../evidence/banned-opcode-replay.json) preserve machine-readable evidence.

## Measured reductions

Gas-budget family: **746 → 252 canonical bytes**, **4 → 2 frames**, **6 real evaluations**, preserved upstream `structure` rejection for declared prefix execution gas plus protocol signature cost exceeding MAX_VERIFY_GAS. The saved first run measured 54 ms after runtime/profile setup; startup and network time are excluded.

TIMESTAMP family: **745 → 251 canonical bytes**, **4 → 2 frames**, **6 real evaluations**, preserved upstream **OP-011**, entity **payer**, stable frame **validation**, and actual opcode **66 / 0x42** in the native trace. The saved reduction measured 55 ms after setup. Timing depends on the host and warm runtime and is not a performance promise.

In each family two optional body calls and four unused array values in the retained call were removed. The remaining owned recipe has no neighbor in the supported edit set, so the final neighbor pass establishes supported-edit local minimality. The byte reduction is approximately **66.2%**. This is neither global minimality nor a security proof.

## Public integration

- Chain: sponsor devnet **1337**.
- Fresh EOA: `0xE2c9b352267973291661FED6DdEe4E8a544e5fDB`.
- Signed transaction: `0x941622177fa644968fbebdb74112b2b4638b575e98c18a36ead9136a96921141`.
- Gateway admission: **accepted**, with passing rule report.
- Identical signed transaction relayed once to the primary after the manual gateway's copy remained pending.
- Authoritative frame receipt: **success**, block **4009 / 0xfa9**, both frame receipts **success**.
- Receipt cumulative gas used: **20,102 / 0x4e86**.

The immediately observed sidecar lifecycle status was `Submitted` even though the execution client's frame receipt was already successful. Both raw values are retained; the receipt establishes execution while sidecar bookkeeping can lag. No stronger finality claim is made.

[Public evidence](../evidence/public-proof.json) includes the raw receipt, admission, endpoint roles, times, actual signed wire fields, and runtime-info responses. The public source commit is unreported; it is not asserted to match the pinned local client/policy. The explorer URL is a convenience; the persisted JSON is the evidence if in-memory explorer history expires.

## Remaining scope

The GitHub Actions workflow is supplied but has not been run on GitHub. Local macOS/Apple Silicon execution and the fresh dependency bootstrap were tested; Linux CI behavior remains to be verified by its first run. Cross-version execution, arbitrary storage-state minimization, atomic groups and arbitrary signed-payload shrinking are outside this release. The public repository and narrated submission video have not been published. Event eligibility remains the organizer's decision, with dated provenance preserved.

Docker Desktop was started during setup, and its existing Rosetta support was enabled to run the amd64 image. No other running containers were present when Docker restarted. The local UI and dedicated runtime are left running for review; stop them with the terminal process and `npm run runtime:down` when finished.

## Explorer CLI addition

The supplied `0xf5b65c…99ef09` URL was tested live with the new `debug` command. It decoded the actual application error (`AnonAI: root from an old generation`), retained four frame descriptions, found no complete signed transaction, and captured three accounts at an explicitly labelled observation block. The report remained diagnostic-only. The locally linked `frameshrink` executable and offline checksum-verified `explain` command were tested. Five additional CLI tests cover endpoint restrictions, revert decoding, missing historical state, boot identity drift, wrong-transaction evidence, tampering and refusal to replay a diagnostic bundle. No public transaction was submitted by this addition.

## Wallet addition

Six wallet/faucet tests passed: idempotent account creation and output redaction, private file permissions and symlink refusal, receipt-matched funding and cooldown, wrong-chain/disabled-faucet refusal, no retry after unknown outcomes, and pending/mismatched receipt behavior. The live sponsor faucet funded the selected fresh CLI wallet with 1 devnet ETH; its successful receipt and public identity are in `evidence/devnet-wallet.json`. The existing real-runtime integration scenario and formatting checks also passed after this change.

## Unified CLI case

A single active-wallet case completed the public rejection → local reduction → signer-free clean replay → corrected public submission flow. The owner-bound validator checks the protocol-validated signer, signature scheme and canonical-message metadata using SIGPARAM; its controlled failing branch executes TIMESTAMP. The fixed deployment funds only 0.01 devnet ETH and remains an experimental fixture.

The public original hash `0xb20cc4daaf82ccd0f8bfde27be1e65843c1a1e7b873859a297ae8cdaa61b73c5` was rejected under OP-011 for TIMESTAMP in frame 0, payer role. The exact signed original bytes replayed locally. Reduction preserved that fingerprint while shrinking **4 → 2 frames**, **767 → 282 bytes**, in **6 evaluations**. Clean replay asserted rejected/rejected/accepted for original/reduced/corrected.

Corrected transaction `0x048c1d34c9bbc3a37bf222614fe4001f2717b30b814766efc1d3edaa999c8ed1` was accepted and executed successfully in public block **5291 / 0x14ab**, with both frames successful. The exact reports, signed payloads, setup, profile, traces and receipt are in `evidence/unified-demo`. A copied bundle was replayed independently from its captured setup; no private key is in the bundle.

Color handling, concise output and uncolored JSON are checked in CLI tests. Three real-runtime scenarios cover the original fixture families and captured EOA/owner-bound-validator reconstruction. Replay remains scoped to relevant captured account state under the pinned local client/policy, not exact reconstruction of the full public chain.

## Interactive wizard

The real terminal wizard was exercised with arrow/space selection, disabled entries, combined/separate grouping, Save & exit, resuming without resending the original, declining the final correction and subsequent confirmed submission. PTY checks verify actual ANSI colors, `--no-color` overriding FORCE_COLOR, and clean Ctrl-C exit 130 without a stack trace (`evidence/terminal-wizard.json`). Eight new unit scenarios cover wallet registry/async isolation, valid failure plans, confirmation gates in both grouping modes, funding cancellation, saved-case wallet recovery and pending receipt reconciliation across separate cases, and refusal of an existing output directory before any deployment.

The combined public case (`evidence/wizard-combined`) captured a real TIMESTAMP rejection, then locally reproduced TIMESTAMP and NUMBER as separate debug stages before the final passing control. It reduced 4 → 2 frames and 767 → 282 bytes; stages used six and three evaluations respectively. Corrected hash `0x1ec45e7e4b919c697eb88a42a6732c4fc3d4136178a47359b560d6d04a386b12` executed successfully in block 6360, with both frame receipts successful. The signed staged evidence is included and keyless replay is supported.

A subsequent separate-case correction was accepted but the public relayer cancelled it after four attempts without inclusion. Its lifecycle reason is retained in `evidence/wizard-relayer-cancelled`; it is an inconclusive public result, not a successful correction. The CLI now detects this lifecycle state, retains the known hash, stops the sequence and does not resend. Receipt polling and public inclusion depend on the external devnet; a locally passing control is never presented as a successful public execution.

The fresh named-wallet wizard also completed a standalone NUMBER case: wallet `0x497a1a3318060016EF70A32989e69b9695e5fc22`, faucet receipt confirmed, real public NUMBER rejection `0x5b722fdea26b4a78e7246ef5fc84794df0b2f759776e4167ec00f7163c7bfad0`, quick-budget reduction 4 → 2 frames / 767 → 282 bytes in six evaluations, clean signed replay, and correction `0xe09397d801116ba47aafdea5f036a51401e62ec7d11a01c7ab033ec2fca87f36` successful in public block 6480. Evidence is in `evidence/wizard-number` and `evidence/wizard-wallet.json`.

## Editor previews and live checks

Four additional unit scenarios verify shell-free configured-editor argument handling, opening a read-only preview copy, actual captured frame/change contents, and wizard ordering (original hash/link before debug, corrected-only final transaction output). The combined real-runtime scenario now verifies every streamed evaluation count and baseline/repeat/control phases, including a smaller same-failure candidate. Existing replay artifacts remain compatible. Previews are separate view-only copies; editor edits cannot replace signed case artifacts.

## Expanded planned categories

The v3 fixture adds three specific cases from previously disabled categories: `FrameShrinkFixtureFailure()` application revert, SSTORE forbidden by read-only validation, and EXTCODESIZE on the captured undeployed owner. Three new unit scenarios check mask planning/stage transitions, refusal of mixed masks/legacy runtimes, and matching public rejection evidence. The new real-runtime integration checks each category, all-five staged reduction, wrong halt/frame/selector refusal, passing controls and clean replay after deleting the fixture key. V1/v2 integration and old regression cases remain covered.

The interactive all-five case is saved in `evidence/expanded-all-five`. The public node rejected original `0x68626d69843238ffb114a2fd3f4aceb219543476bba97a4b68361c1d583c404f` for the fixture's explicit revert. Local debugging then proved all five selected failures in 18 evaluations (6 + 3 + 3 + 3 + 3), reduced 4 → 2 frames / 767 → 282 bytes, and replayed the exact signed stages. Corrected `0xd167ef14914854d92bfca7c87540c7cc28291d7ba3717f20ec1cd803c266b6ce` executed successfully in public block 6923 with both frames successful. This is a controlled fixture correction, not arbitrary custom-contract repair.

Standalone public checks also captured the static-write rejection (`0x0635ee2acdffa83db4e95630c9cba17892ef245eedc0332c22153bc4dfa248ba`) and undeployed-owner code-access rejection (`0x03a90fd3a849248fa3bd49a4256cab4224c6bff726ffedaf335c54295c2dacc3`). Both reduced 4 → 2 frames / 767 → 282 bytes, used six reduction evaluations, and passed clean original/reduced/corrected replay. Their correction submission was deliberately declined in those checks; the all-five case above establishes successful public execution of the same all-disabled v3 fixture behavior. Cases are retained in `evidence/expanded-static-write` and `evidence/expanded-code-access`.

## Downloadable npm and Git release

The CLI now has filled status badges and omits the trailing absolute case-directory line on successful transaction runs. Recovery commands use case IDs; JSON retains artifact paths. The local repository is prepared as a normal main-branch Git history with explicit prior-work/AI attribution.

The npm tarball contains a compiled ESM CLI with pinned sidecar code and bundled dependency license notices, fixed fixtures and a portable five-stage example. There are no install/build hooks. Fresh-folder checks install with scripts disabled, run the CLI with Git/Bun blocked, verify persistent state outside the installed package, and use an isolated npm-exec cache without a global installation. Both installed and npm-exec variants replay the real five-stage sample with Docker. A modified compiled bundle is refused by the build-manifest check. Runtime dependencies are limited to the interactive prompt package; source builds retain their pinned development toolchain.

Source type checking, 37 unit tests, five real-runtime integration scenarios, the browser test, package install/exec replay, and formatting passed locally. `evidence/package-check.json` records package checks. Packaging/install tests make no public submissions. Linux CI remains supplied rather than remotely verified. No package or Git remote has been published.

## 0.1.1 polish review

The local replay now emits verified stage results and reports the captured frame/byte reduction. It does not claim a new reduction search occurred during replay. Activity indicators cover real asynchronous work, pause before interactive prompts, and are excluded from JSON. Missing Docker stops before artifact creation or validator deployment; first-run image preparation uses the pinned digest. `demo` without a subcommand selects local replay rather than public automation.

Five additional unit scenarios cover compact balance/byte presentation, correct inconclusive labels, Docker prerequisites/image download, and duplicate wallet names. The real v3 replay test now also refuses a forged display label even when a bundle's checksums were recomputed. Clean-folder package tests cover actionable Docker failure without creating a state directory and both explicit/local-default replay. Source strict typing, 42 unit tests, five real-runtime integration scenarios, the browser scenario, package install/npm-exec replay, and formatting checks passed during the review. Public test submissions were not needed for this visual/flow update.
