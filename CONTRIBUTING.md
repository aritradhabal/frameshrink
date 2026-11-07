# Contributing

Use Node.js 22.13+ (22.x) or 24+ and a running Docker engine. Run `npm ci`, `npm run bootstrap`, then `npm run build`.

Before submitting a change, run `npm test`, `npm run test:integration`, `npm run test:browser` with the local workbench running, `npm run format:check`, and `npm run test:package -- --runtime`. Run runtime and packaged portability tests sequentially because the dedicated Docker containers and ports use one user-wide lock independent of FRAMESHRINK_HOME. Use `npm run test:portable` for focused browser/lock checks and `npm run test:portability -- /path/to/package.tgz` for installed-package smoke checks.

Keep fixture, signature, state and policy checks explicit. RPC errors and unknown halt reasons must never count as preserved failures. Public writes belong only in explicitly requested devnet workflows, not automatic tests or package installation.

Do not commit `.runs`, wallets, private keys, `.env` files, installed dependencies or built distributions. Preserve upstream licenses and AI/provenance attribution. Maintain downloadable npm tarballs. Registry publication is an explicit authenticated maintainer action after release checks pass; do not add automatic publishing to ordinary test or push workflows.
