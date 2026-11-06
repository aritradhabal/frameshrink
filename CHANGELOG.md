# Changelog

## 0.1.1 — terminal and demo polish

- Show each verified failure stage during local replay, with aligned results, filled status labels and a captured-reduction summary.
- Add activity indicators around wallet, deployment, simulation and public-receipt waits; pause them for prompts and keep JSON clean.
- Make `frameshrink demo` default to the wallet-free local replay. Public automation remains the explicit `demo run` command.
- Check Docker and the pinned image before deployment or local-case creation, with actionable errors and first-run image download feedback.
- Prevent duplicate new-wallet names, shorten balance displays, and keep planned choices within ordinary terminal widths.
- Label inconclusive public outcomes UNCONFIRMED consistently, rather than PENDING.
- Verify replay stage labels against the actual failure fingerprint before reporting success.
- Validate the npm package version dynamically and exercise missing-Docker behaviour in clean-folder package tests.

## 0.1.0 — unpublished local distribution

Initial Git-backed CLI distribution, five supported controlled failure cases, owner-bound fixtures, captured replay, local sample, and installable npm tarball. No registry or remote repository publication.
