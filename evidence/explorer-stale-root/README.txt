FrameShrink · explorer investigation
Transaction: 0xf5b65c96057977aaab766eb055520a001b22662c8dffef555068e7e56899ef09
Node: https://altmempoolgateway.forshtat.com/rpc
Observed outcome: rejected · 4 retained frames

Failure: simulation · frame 0
  Error(string): AnonAI: root from an old generation

Signed transaction: unavailable
Current account data: 3 account(s) at block 0x11a7; NOT original rejection state
Reproduction: diagnostic-only
Missing:
  - Complete signed transaction (explorer entry and chain lookup do not supply it)
  - Historical pre-rejection chain state, including required storage and root/proof context
  - Exact original client/sidecar builds and admission policy/stake/reputation snapshot
  - Owned rebuild recipe and authorization to re-sign edited candidates

Inference: The application validator appears to reject an outdated proof/root generation. Contract code and historical storage are needed to confirm the mechanism. This error string does not establish an EIP-8272 recent-root failure.

Next steps:
  1. Obtain the validator source/ABI, proof-generation inputs and accepted root-generation state from the application developer
  2. Reproduce the unchanged validation revert in an owned, matching local setup
  3. If the source confirms a stale proof, regenerate the proof/witness for an accepted generation; rebuild and re-sign, then verify the corrected control
  4. Add an application-specific recipe and exact revert predicate before enabling reduction; this release does not minimize arbitrary validation reverts

Captured read-only evidence, not a portable regression fixture. Latest-observed code/balance/nonce do not reconstruct original storage or policy. No signing, simulation or submission was performed. Checksums detect modifications; they are not a third-party authenticity proof.
