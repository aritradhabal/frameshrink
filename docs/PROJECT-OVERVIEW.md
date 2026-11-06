# FrameShrink

Reduce a failing EIP-8141 fixture, preserve its actual failure, and export a regression case another developer can replay from clean local state.

**Implemented and verified on 6 November 2026:** TypeScript CLI, local browser workbench, real ethrex simulation, pinned upstream policy validation, fresh signatures after edits, deterministic reduction, checksummed export, clean reconstruction/replay, read-only signed imports and a unified public rejection → local reduction/replay → successful public correction.

![FrameShrink workbench](evidence/workbench-desktop.png)

## Downloadable CLI package

Download the prepared `frameshrink-0.1.0.tgz` and try it without a global installation:

```sh
npm exec --yes --package=./frameshrink-0.1.0.tgz -- frameshrink demo local
```

The included sample replays all five failure stages and the corrected control locally. Docker is required; no wallet, faucet funds, Git/Bun build, or public transaction is needed.

```sh
npm install --global ./frameshrink-0.1.0.tgz
frameshrink start transaction
```

The npm package is unpublished and ships a compiled CLI, pinned sidecar code, fixtures and dependency notices. Wallet data lives in `~/.frameshrink` for installed/npm-exec copies; development checkout commands retain `.runs`. [Installation and source-build instructions](docs/PACKAGING.md).

## Unified CLI demo

```sh
npm link
frameshrink start transaction
```

The terminal wizard lets you pick or create a CLI wallet, request faucet funds, select failures, and choose **one combined transaction or separate transactions** each run. The wizard offers five controlled cases: an application-defined test revert, a state write during read-only validation, forbidden `TIMESTAMP` and `NUMBER` reads, and code access to an undeployed owner account. Other categories remain visible but disabled. Separate cases run sequentially with confirmation for each original and correction.

The wizard asks before validator deployment, before sending the failing transaction, and before sending the correction. Setup funds the validator with **0.01 devnet ETH** plus deployment gas. It captures the real public rejection, reduces locally, walks through every selected failure, verifies exact signed replay, then shows a terminal change summary and offers a detailed report in your configured/default editor. Transaction frames can also be previewed before submission; press O to open or C to continue. Each local reduction check streams its result as it completes. In a combined case the public node may expose only the first failure. Execution-halting cases are corrected first, then subsequent local stages expose the remaining policy violations. Intermediate debug candidates stay local. The correction skips the fixture's deliberate failing branches while keeping owner authorization enabled; this is a controlled test correction, not arbitrary contract repair.

```sh
# Continue after Save & exit or declining the correction:
frameshrink start debug /absolute/path/to/case
frameshrink replay /absolute/path/to/case
# Reconcile a known pending correction; never resend:
frameshrink demo resume /absolute/path/to/case
```

The expanded [all-five case](evidence/expanded-all-five/) reproduced every selected failure locally and its corrected transaction succeeded in public block **6923**. It reduced **4 → 2 frames**, **767 → 282 bytes**, with 18 reduction evaluations across five stages. Selecting a new category deploys a v3 test validator after confirmation; older validators are retained.

The interactive [combined case](evidence/wizard-combined/) succeeded in public block **6360** after debugging both selected failures. The fresh-wallet [NUMBER case](evidence/wizard-number/) succeeded in block **6480**, including CLI wallet creation and confirmed faucet funding. Both reduced **4 → 2 frames**, **767 → 282 bytes**. A separate relayer cancellation is retained as an inconclusive result; the CLI reports the reason and never resends automatically.

The earlier single-failure [complete case](evidence/unified-demo/) remains available: **4 → 2 frames**, **767 → 282 bytes**, with public success in block **5291**. `frameshrink demo run` retains the automatic single-TIMESTAMP workflow for scripts; use `start transaction` for the interactive confirmations.

Terminal output is concise and colored on supported terminals. `--verbose` expands diagnostic details; `--json` returns uncolored machine output; `--no-color` and `NO_COLOR` disable colors. The CLI does not require the web UI. Docker is required for reduction/replay; the case runtime uses loopback port 18546 and its own `frameshrink-case-ethrex` container.

The reconstructed fixture preserves the relevant EOA/validator code, balances, nonces, chain ID and exact signed payloads; it is not a full snapshot of the public chain. The local client/policy is explicitly pinned while the public node's source commit remains unreported. This is an owned test case, not an imported historical application incident.

## Verified results

| Owned failure family | Original | Reduced | Real evaluations | Clean replay |
|---|---:|---:|---:|---|
| Verification gas budget | 4 frames / 746 bytes | 2 frames / 252 bytes | 6 | Passed |
| Banned TIMESTAMP opcode | 4 frames / 745 bytes | 2 frames / 251 bytes | 6 | Passed |

Both reductions remove two optional body calls and the required call's unused ABI array elements. Both preserve the exact evidenced failure fingerprint. Corrected controls pass the covered local policy checks. Local minimality is established for the supported edit set; gas quantities are fixed and no global minimality is claimed.

The separate [public transaction](https://explorer.altmempool.wtf/tx/0x941622177fa644968fbebdb74112b2b4638b575e98c18a36ead9136a96921141?node=https%3A%2F%2Faltmempool.forshtat.com%2Frpc) was admitted and executed successfully in block **4009** on sponsor test chain **1337**, with both frame receipts successful. Raw admission, status, signed payload and receipt are preserved in [evidence/public-proof.json](evidence/public-proof.json). The public gateway did not report its source commit; it is not presented as identical to the pinned local profile.

## Start

Requires Node.js 22.13+ (22.x) or Node.js 24+, npm, Git and a running Docker engine. On Apple Silicon, enable Docker Desktop's Rosetta support for the pinned x86 ethrex image. The original default QEMU emulation crashed on the tested host; Rosetta resolved it. Bootstrap installs a project-local Bun binary; no global Bun is required.

```sh
cd /Users/aritra/Documents/project/frameshrink
npm ci
npm run bootstrap
npm run runtime:up
npm run verify
npm start
```

Open **http://127.0.0.1:4317**. Choose a fixture, reduce it, export it and replay it from clean state. Ports 4317 and 18545 must be free. On a different machine, use the directory where you extracted or cloned this project.

`runtime:up` resets only the dedicated `frameshrink-ethrex` container. It runs without mining and publishes RPC on loopback only. `runtime:down` removes that container. The app does not run a full local mempool or submit candidates.

## Test wallet and failure catalogue

After `npm link`, use `frameshrink wallet create`, `frameshrink whoami`, `frameshrink wallet faucet` and `frameshrink wallet status`. The wizard supports multiple named local development EOAs and verifies sponsor chain 1337 before network operations. Legacy wallet commands use `.runs/wallet`; named wizard wallets use `.runs/wallets/<name>`. The selected identity is scoped to that wizard run. Keys have private file permissions and are never printed. Faucet success is verified by receipt. This is a local signing identity, not a website login or deployed account-abstraction contract.

Run `frameshrink failures` for the full failure-family catalogue and current reducer support. See [failure families](docs/FAILURES.md) and [wallet/CLI workflow](docs/CLI-WORKFLOW.md).

## Investigate an explorer link

A terminal-first workflow is now available. From this checkout, run `npm link` once, then:

```sh
frameshrink debug 'https://explorer.altmempool.wtf/tx/0xf5b65c96057977aaab766eb055520a001b22662c8dffef555068e7e56899ef09?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc'
frameshrink explain /absolute/path/to/the/saved-case
```

The command decodes the rejection, captures read-only evidence and available current account data, and names the artifacts missing for exact replay. It never treats current state as historical prestate. Your supplied case decodes to `AnonAI: root from an old generation`; its full transaction and historical setup are unavailable, so it is diagnostic-only. This arbitrary revert is not yet a supported reducer family. See [the CLI workflow and product goal](docs/CLI-WORKFLOW.md).

`debug` supports `--out <new-directory>` and `--json`; `explain` works offline with checksum verification. A linked development executable uses this checkout; downloaded tarballs run the bundled CLI. Nothing has been published to npm. `./bin/frameshrink.mjs` also works directly. Normal URL investigation does not require Docker; supported local evaluation/replay does.

## CLI

```sh
npm run cli -- doctor
npm run cli -- inspect fixtures/verify-gas.json
npm run cli -- evaluate fixtures/verify-gas.json
npm run cli -- reduce fixtures/verify-gas.json --out .runs/my-case
npm run cli -- replay .runs/my-case
npm run cli -- compare evidence/verify-gas-first evidence/banned-opcode
```

An export directory must not already exist. Replay checks the bundle before reconstructing the dedicated container. `compare` compares saved evidence; it does not run two client versions or establish the cause of a behavior change. Only the included pinned runtime profiles and documented captured-case reconstruction are supported in this release.

Commands show concise human-readable output by default. Use `--verbose` for diagnostic detail or `--json` for machine output with schemaVersion. Exit codes: **0** expected outcome, **2** invalid input, **3** unsupported environment/profile, **4** inconclusive/runtime failure, **5** regression mismatch. An expected policy rejection is a passing regression outcome.

A signed import is a JSON file with `schemaVersion: 1`, `mode: "imported"`, and a canonical `raw: "0x06…"` payload. `inspect` decodes it without mutation, signing or submission. Imports remain diagnostic-only because their external state is not available.

## Verification

```sh
npm run verify
npm run format:check
npm audit
# With npm start running in another terminal:
npm run test:browser
```

On macOS, browser verification uses installed Google Chrome. On Linux install Playwright's browser first with `npx playwright install --with-deps chromium`. Set `PLAYWRIGHT_CHROME_PATH` to select another installed Chrome executable.

The suite checks strict inputs, stable IDs, ABI edits, fresh valid signatures, malformed signed imports, unstable baseline refusal, both real failure families, different-failure refusal, state drift, budget exhaustion, clean replay, checksum tampering, RPC submission prohibition, browser export/replay, mobile overflow, Origin/session enforcement and Host validation. Root dependency audit results are saved separately; they do not constitute an audit of inherited sidecar or ethrex code.

## Public sponsor proof

Public writes are isolated from the workbench. `npm run proof:public` creates or reuses a private test key in ignored `.runs/public-proof.key` (0600), requests sponsor test funds if needed, and submits one corrected EOA self-relay on chain 1337. It stores only public evidence in `evidence/public-proof.json`. Do not use a real-money key. The command is deliberately **not** part of tests or normal startup.

The manual gateway originally admitted the transaction but did not deliver it to the primary during the observation window. `npm run proof:public -- --relay-primary` relayed the **identical signed transaction** to the auto-bundling primary, where it received a successful receipt. It does not create a second transaction or spend the same nonce twice. A submission with an unknown network outcome is not automatically retried with a fresh nonce.

The completed evidence is included, so no new public write is needed to review this build. The test account's remaining faucet funds and key are local development material and are excluded from source archives.

## Project map

- `src/recipe.ts`: strict owned inputs, ABI builder, fresh disposable signatures and typed edits.
- `src/runtime.ts`: pinned real-client identity, state checks, simulation and upstream validator adapter.
- `src/reducer.ts`: deterministic scheduling, fingerprint preservation, cache, budgets and neighbor pass.
- `src/bundle.ts`: fixed-file exports, checksums, verification and replay assertions.
- `src/cli.ts`, `src/server.ts`, `src/ui.html`: CLI and local workbench.
- `fixtures/`, `contracts/`, `scripts/`: controlled genesis, owned payload contract, reproducible setup and separate public proof.
- `evidence/`: measured bundles, replay results, screenshots, public proof and verification outputs.

See [architecture and security boundaries](docs/ARCHITECTURE.md), [demo script](docs/DEMO.md), [provenance and upstream attribution](docs/ATTRIBUTION.md), [sponsor integration feedback](docs/SPONSOR_FEEDBACK.md), and [verification report](docs/VERIFICATION.md).

## Limits

The local evaluator covers the pinned trace/structural policy checks, not all mempool admission stages. Storage-specific reduction, arbitrary transactions, cross-version execution, atomic groups and quantity reduction are not implemented. The second supported family is the directly evidenced banned-opcode case. Toy local wallets intentionally approve unconditionally and are unsuitable for real funds. Exports reproduce the controlled local environment, not arbitrary public chain history.

Advance research and AI-assisted implementation dates are disclosed in the provenance file. This project does not claim a particular event's eligibility or prize qualification; the organizer determines the applicable track. No public repository publication or narrated submission video is claimed.

MIT licensed. Upstream work retains its original license and attribution.
