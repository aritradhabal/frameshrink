# CLI demonstration

Start with the [current quick-start](../README.md). Node.js and Docker must be ready. The wallet-free command `frameshrink demo` verifies the captured five-stage case and its passing correction; it makes no public submissions.

## Create a new public-devnet case

1. Run `frameshrink start transaction`. Choose or create a CLI wallet and request faucet funds if needed.
2. Select supported failures and choose one combined transaction or separate cases. The all-five selection covers test revert, static write, TIMESTAMP, NUMBER and undeployed-owner code access.
3. Approve validator setup if requested. At the transaction preview, press O + Enter to inspect decoded frames in the configured editor; C + Enter continues. Confirm the failing submission.
4. Show the public rejection hash/link. Start debugging and watch one live check row, with one persistent summary per failure. Add `--verbose` to print every check.
5. Show the reduced frame/byte count and named corrections. Open the detailed change report if useful. Clean replay verifies the exact signed cases before correction submission.
6. Confirm the corrected submission. A successful execution receipt produces CONFIRMED plus the corrected hash/link, which opens once in the default browser. Use `--no-open` to keep links in the terminal.
7. Share the saved case and replay it with `frameshrink replay <case-directory>`; no signing key is needed.

## Recorded examples

The [all-five case](../evidence/expanded-all-five/) reduced 4 frames / 767 bytes to 2 frames / 282 bytes across 18 reduction checks (6 + 3 + 3 + 3 + 3). Its correction succeeded in public block 6923. The earlier [TIMESTAMP + NUMBER case](../evidence/wizard-combined/) succeeded in block 6360, with six and three checks respectively. These are recorded outcomes, not guarantees for a future devnet run.

Reduction removes irrelevant calls and ABI values while preserving the current failure. Correction separately disables the fixture's deliberate failing branches, retaining owner authorization. Intermediate candidates remain local. Reproduction reconstructs relevant captured state under the pinned client/policy, not the full public chain.

`frameshrink start debug <case>` continues after Save & exit or a declined correction. `frameshrink demo resume <case>` reconciles a known pending hash without resending. Unknown responses and relayer cancellation remain inconclusive.

The optional browser workbench demonstrates the two original local fixture families. URL-import diagnosis supports unrelated public rejections with explicit missing-artifact limits. See [verification](VERIFICATION.md) for raw evidence and [packaging](PACKAGING.md) for platform support. No narrated submission video or public repository publication is claimed.
