# Download and run

Downloadable artifacts are `frameshrink-0.1.6.tgz` (installable CLI), `frameshrink-source.zip` (source), and `frameshrink.git.bundle` (Git history). The unscoped npm package name is `frameshrink`. Registry publication is an explicit authenticated maintainer action. Use the actual tarball path when testing a downloaded artifact; use `npx frameshrink` for the registry release.

Requires Node.js 22.13+ (22.x) or Node.js 24+. Docker is required only for simulation and replay. On Apple Silicon, enable Docker Desktop Rosetta support for the pinned amd64 ethrex image.

## Try without a global installation

```sh
npm exec --yes --package=./frameshrink-0.1.6.tgz -- frameshrink --help
npm exec --yes --package=./frameshrink-0.1.6.tgz -- frameshrink demo local
npm exec --yes --package=./frameshrink-0.1.6.tgz -- frameshrink start transaction
```

`npm exec` downloads the package's runtime dependencies into npm's cache. It does not require a global install. `demo local` reconstructs the included five-failure case, verifies exact signed replay and its corrected control, and makes no public submissions. It needs no wallet, faucet funds, Git, Bun, or sidecar checkout. Docker can download the pinned execution image on first use.

`demo` without a subcommand also selects the local replay; it never defaults to a public submission. Missing/stopped Docker is reported before case files are created; a missing pinned image is downloaded with a first-run activity indicator.

`start transaction` runs the interactive public-devnet workflow with its explicit deployment/submission confirmations.

The interactive workflow opens each confirmed correction in your default browser, once per transaction. The funding menu can also open the faucet. Original rejection links remain available in the terminal without interrupting debugging. Add `--no-open` or set `FRAMESHRINK_NO_OPEN=1` to suppress browser launching. JSON, piped output, CI, and local replay never open a browser; launch failures do not affect transaction results.

Local checks reuse one live terminal row and preserve a summary per failure. Reopening previews or checking a pending receipt does not add repeated prompt answers to scrollback. `--verbose` prints each local check; new debugging runs also save every check in the checksum-covered `evaluation-log.json`. Editor previews retain precise masks and signed payloads while the terminal shows named corrections. `CONFIRMED` means a successful execution receipt was verified; admission alone does not earn that label.

## Install the downloaded package

```sh
npm install --global ./frameshrink-0.1.6.tgz
frameshrink --version
frameshrink demo local
frameshrink start transaction
```

A project-local install also works: `npm install ./frameshrink-0.1.6.tgz`, then `npx frameshrink --help` from that project.

Installed and npm-exec copies store wallets, faucet history, cases and previews in `~/.frameshrink`. Set `FRAMESHRINK_HOME=/absolute/path` to choose another persistent directory. Source checkout commands retain their existing `.runs` directory unless that variable is set. Package updates and npm-cache cleanup do not delete your default wallet data.

Updated copies coordinate the fixed Docker containers and ports through `~/.frameshrink/runtime`, regardless of `FRAMESHRINK_HOME` or source/package location. Direct `npm run runtime:up` / `runtime:down` commands obey the same lock. A verified dead process can be recovered; live or unknown ownership is preserved. Close releases older than 0.1.3 before concurrent use: they do not participate in the shared protocol. The lock coordinates one OS user, not different users sharing a Docker daemon.

The normal successful wizard output ends with the corrected transaction hash/link, without an absolute case-directory line. Saved and pending runs show a recovery command using a case ID. `frameshrink start debug <case-id>` and `frameshrink demo resume <case-id>` resolve IDs inside the data directory; explicit case paths also work. JSON retains full artifact metadata.

## Build from the Git repository

```sh
npm ci
npm run bootstrap
npm run build
npm test
npm run test:integration
npm run test:package -- --runtime
mkdir -p artifacts
npm pack --pack-destination artifacts
```

Bootstrap is a maintainer/source-build step. It checks out the pinned upstream sidecar and builds it with a pinned local Bun binary. The resulting npm tarball bundles the required implementation and third-party notices, so recipients do not repeat that step. The compiled CLI verifies its build manifest before local simulation. The package deliberately exposes the CLI only; it does not promise a stable JavaScript library API.

No install hooks run build tools or request funds. Public publishing uses `npm publish --access public` with npm authentication; the source `prepublishOnly` hook runs build, unit and formatting checks. The registry/access settings are fixed in `publishConfig`. The source repository is public on GitHub; this local release command does not publish artifacts to a remote host or registry.

To create a normal local clone from the Git bundle:

```sh
git clone ./frameshrink.git.bundle frameshrink
cd frameshrink
```

The bundle contains the real initial commit and main branch. No remote host or registry upload is needed.

## Local release maintenance

After verification, commit the source and create an annotated `v<package-version>` tag. Run `npm run release:local -- /absolute/output/directory` from a clean working tree. It builds the tarball, archives earlier release files under `archive/<version>/`, produces a source ZIP and complete Git bundle, checks the bundle through a clean clone, and writes `SHA256SUMS` plus `RELEASE.txt`. It never publishes. The release tag must point to the current commit and cannot silently move to another commit.

Run `npm run test:portability -- /absolute/path/to/frameshrink.tgz` to check installation, a private test wallet, shared locking, JSON workbench startup and occupied-port errors without Docker or desktop launching. The CI matrix repeats packaged checks and focused browser/lock tests on Linux, macOS and Windows with Node 22 and 24. CI configuration alone is not evidence of a successful remote run; consult the verification report for observed platforms. Source bootstrap currently supports macOS/Linux, while Windows CI consumes the already built tarball.
