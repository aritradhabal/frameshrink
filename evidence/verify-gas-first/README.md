# FrameShrink local regression

From the pinned FrameShrink checkout, run `npm run cli -- replay /absolute/path/to/this-bundle`. Replay resets the dedicated frameshrink-ethrex container and reconstructs genesis. It verifies every checksum, runtime identity, signatures and both failure fingerprints, then tests the corrected control.

The signed payloads use a public disposable local signer and intentionally unconditional APPROVE fixture wallet. Never fund or deploy it publicly. No private keys or provider secrets are in this bundle.

Policy scope excludes full mempool admission, fees, replacement, reputation admission and gossip. Local minimality applies only to the listed typed edit set; gas quantities are held fixed. This bundle is a local regression case, not public admission or execution evidence.
