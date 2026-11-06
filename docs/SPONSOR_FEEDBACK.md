# Sponsor integration feedback

Observed 6 November 2026 during FrameShrink implementation.

## Working integration

The pinned ethrex image exposed `ethrex_simulateFrameTransaction` with real per-frame ERC-7562 traces. It returned complete successful execution/trace data even when canonical policy rejected the declared verification budget or TIMESTAMP. This let FrameShrink reuse the upstream policy validator rather than infer causes from generic errors.

The public `.forshtat.com/rpc` endpoints responded; the older `.wtf` forms did not provide equivalent direct RPC access in our probes. The gateway faucet funded a fresh private test account. A corrected two-frame EOA self-relay was accepted, with an admission report containing passing rule checks. Raw responses are in `evidence/public-capabilities.json` and `evidence/public-proof.json`.

## Reproducible friction

- The available ethrex image manifest had only an amd64 runtime. On this Apple Silicon host the default QEMU execution logged signal 11; enabling installed Docker Rosetta support allowed the same pinned image to start. An arm64 image would remove this setup dependency.
- The public gateway advertised manual bundling and P2P enabled. Its admitted transaction remained New while the primary reported it unknown during the observation window. Relaying the identical signed payload directly to the auto-bundling primary yielded a successful receipt in block 4009. This observation does not identify the cause as a gossip defect; peer state or configuration may explain it.
- Public explorer info reported an empty commit string. Local reproducibility can pin a digest/commit, but a public admission cannot be matched to that source with the available info.
- Some upstream devnet documentation still shows a linear `nonce` field while the pinned codec/API uses `nonceKeys` and `nonceSeq`, plus recent-root fields. Versioned examples would help avoid copying incompatible wire JSON.

## What FrameShrink adds

The sidecar already explains admission failures. FrameShrink adds deterministic owned-fixture reduction, preserved failure predicates, fresh signatures, content/state/profile-aware caching, exported setup and a clean regression replay. The two measured families cover a structural gas rejection and an opcode trace rejection. No maintainer time-saved claim or testimonial is inferred from these results.

This feedback is a local document; it has not been sent to maintainers or organizers.

## Unified CLI validation on the event devnet

The first high-budget EOA probe was accepted by the public node while the pinned local policy rejected it. The tool stopped without claiming rejection; this is retained in `evidence/public-profile-difference.json`. We selected an owned conditional-TIMESTAMP validator instead, and obtained an OP-011 public rejection followed by local reduction and a successful corrected public receipt. This underlines the importance of verifying the running profile instead of assuming that every documented gas limit applies to every account type.

The completed owned-validator case is preserved in `evidence/unified-demo`: 767 → 282 bytes, 4 → 2 frames, six evaluations, exact signed replay, successful public correction in block 5291. Public original and corrected admission reports identify the same intentional test case; the new pipeline no longer relies solely on a separate integration transaction.
