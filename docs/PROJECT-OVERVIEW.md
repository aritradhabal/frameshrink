# FrameShrink project overview

FrameShrink reduces a failing Ethereum frame transaction into a smaller reproducible test case while preserving the same evidenced failure.

Use the [current README](../README.md) as the single quick-start and the [packaging guide](PACKAGING.md) for downloadable CLI installation and source builds. Nothing is published to npm or a remote Git host.

## What is implemented

- A minimal colored terminal wizard: choose/create a CLI wallet, fund it, choose combined or separate failures, preview frames, confirm submission, debug locally, review changes, and confirm a correction.
- Five controlled fixture choices: application test revert, validation state write, forbidden TIMESTAMP, forbidden NUMBER, and undeployed-account code access.
- Exact signed payload capture, owner-bound authorization, fresh signatures after edits, stable failure fingerprints, reduction budgets, checksummed evidence, and keyless replay.
- Public-devnet rejection and successful correction evidence, kept separate from local reproduction results.
- A wallet-free five-stage replay demo, URL-based diagnosis, and a local browser workbench for the two original fixture families.
- Installable npm tarball, source ZIP, complete Git bundle, release checksums, third-party notices, and prior-work/AI attribution.

Candidate checks update one live terminal row; stage summaries and explicit submission decisions remain. Use `--verbose` for every check, or inspect `evaluation-log.json` in newly generated cases. Previews use VISUAL, then EDITOR, then the system default. Confirmed corrections open once in the browser; `--no-open` disables this. See the [CLI workflow](CLI-WORKFLOW.md).

## Demonstrated result

The [all-five captured case](../evidence/expanded-all-five/) reduced **4 → 2 frames**, **767 → 282 bytes**, with 18 reduction checks across five stages. Its corrected transaction executed successfully on sponsor chain 1337 in public block **6923**. The [verification report](VERIFICATION.md) preserves the precise claims, earlier cases, limitations, and check results.

`frameshrink demo` replays captured evidence and checks the corrected control locally; it does not perform a new reduction search or public submission. `frameshrink start transaction` creates a new owned test case and requires explicit public-write confirmations. An arbitrary explorer link can provide diagnosis without enough historical state for exact replay.

## Runtime and data

Installed/npm-exec copies store keys and cases in `~/.frameshrink`; a source checkout defaults to `.runs`. `FRAMESHRINK_HOME` changes case/wallet storage. The fixed Docker containers and loopback ports are coordinated by one user-wide lock in `~/.frameshrink/runtime`, independent of those data directories. Runtime start/stop, simulation and replay use that same lock. Run only updated copies together: older releases did not participate in this shared protocol. Separate OS users sharing one Docker daemon are outside this locking scope.

The workbench listens on loopback port 4317, the local fixture runtime uses 18545, and captured-case reconstruction uses 18546. Occupied workbench ports produce a concise error; `frameshrink serve --json` emits a ready object on startup or a structured error on failure.

## Scope and limits

These are owned fixture adapters, not arbitrary-contract repair or a historical snapshot of the full public chain. The local client and policy are pinned; the public node's source commit is unreported. Reproduction covers relevant captured account code, balances, nonces, chain ID and exact signed bytes. Unsupported or incomplete evidence stays inconclusive. Minimality applies only to supported edits.

Development keys are stored unencrypted with private permissions and excluded from packages/history. Do not use real-money keys. Test fixtures and development wallets are experimental. Event eligibility remains the organizer's decision; see [attribution](ATTRIBUTION.md).

## Project map

| Path | Responsibility |
|---|---|
| `src/recipe.ts`, `src/reducer.ts` | Supported edits, budgets, search and fingerprint preservation |
| `src/runtime.ts`, `src/case-runtime.ts` | Real execution, policy checks and controlled reconstruction |
| `src/demo.ts`, `src/wizard.ts` | Public/local case orchestration and terminal interaction |
| `src/wallet.ts`, `src/self-relay.ts` | Owned development identity and bounded signing |
| `src/preview.ts`, `src/browser.ts` | View-only editor reports and controlled link opening |
| `src/server.ts`, `src/ui.html` | Local browser workbench |
| `scripts/runtime-lock.mjs` | Shared runtime ownership for CLI and direct runtime commands |
| `fixtures/`, `examples/`, `evidence/` | Test setup, portable replay sample and measured results |

See [architecture](ARCHITECTURE.md), [demo guide](DEMO.md), [packaging](PACKAGING.md) and [verification](VERIFICATION.md).
