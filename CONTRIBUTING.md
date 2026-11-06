# Contributing

Use Node.js 22.13+ (22.x) or 24+ and a running Docker engine. Run `npm ci`, `npm run bootstrap`, then `npm run build`.

Before submitting a change, run `npm test`, `npm run test:integration`, `npm run test:browser` with the local workbench running, `npm run format:check`, and `npm run test:package -- --runtime`. Run runtime tests sequentially because the dedicated Docker containers and ports are shared.

Keep fixture, signature, state and policy checks explicit. RPC errors and unknown halt reasons must never count as preserved failures. Public writes belong only in explicitly requested devnet workflows, not automatic tests or package installation.

Do not commit `.runs`, wallets, private keys, `.env` files, installed dependencies or built distributions. Preserve upstream licenses and AI/provenance attribution. Distribution is through a locally built npm tarball; publishing is disabled.
