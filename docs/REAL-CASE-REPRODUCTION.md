# From a public rejection to a reproducible FrameShrink case

Checked 6 November 2026. The application currently reduces owned development recipes, not arbitrary historical Ethereum transactions.

## What our demo actually does

1. `src/recipe.ts` builds one VERIFY frame plus three SENDER body calls to the owned `PayloadSink.consume(uint256[])` contract. One body call is marked required by the recipe. Contracts and balances are installed in an isolated chain-9 genesis.
2. The gas fixture declares 120,000 execution gas for validation. Its SECP256K1 signature adds 2,800 verification gas in the pinned implementation: 122,800 exceeds the configured 100,000 verification limit. This concerns declared validation budget, not 122,800 gas measured as consumed by contract execution.
3. Each candidate is ABI-encoded, canonically serialized and freshly signed. Real ethrex simulates it at block 0 with tracing; FrameShrink applies the pinned upstream sidecar validator. Stake/reputation inputs are fixed local fixture data. A complete local mempool service is not involved in candidate evaluation.
4. The reducer removes independent body calls and array elements irrelevant to the target rejection. It retains only candidates with the same failure fingerprint, successful execution evidence and unchanged profile/state. It does not fix the transaction during reduction. In particular, removing execution-body calls does not reduce this validation-prefix gas budget.
5. The final required call remains because the recipe's edit set forbids its removal. The two-frame result is minimal for that edit set; it is not proven to be the mathematically smallest transaction with this rejection.
6. Replay verifies checksums, recreates the isolated runtime, rebuilds/signs both recipes and asserts the same failure. A separate corrected control lowers validation gas to 30,000 and passes the covered checks.

The TIMESTAMP family executes a local wallet that deliberately reads TIMESTAMP before APPROVE. The actual trace contains opcode 66 (0x42), and the upstream validation policy rejects OP-011. TIMESTAMP is an ordinary EVM instruction: this restriction concerns its use in the specified validation context, not every Ethereum contract.

## Real public records found

Read-only calls to `skandha_explorer_listAdmissions` on the sponsor endpoints returned these cases. Raw responses are preserved in `evidence/rejection-research/public-rejections.json` and the selected reports in `selected-cases.json` alongside it.

| Record | Observed rejection | Relationship to the demo |
|---|---|---|
| `0xb13027388242d52c475f4f505d017d2450acde4369299e1888b5d7b16b0a15ae` on the gateway | `prefix gas budget exceeded: 540100 > 100000 (MAX_VERIFY_GAS)`; four frames | Same gas-budget failure class, different signed transaction and environment |
| `0x4b2f4d82b298188c20fe178204d430192470f64bb3780dcdc2dd223abddc5cfd` on the primary | `unstaked payer accessed payer slot 0x0000000000000000000000000000000000000000000000000000000000000000`; four frames | A real validation-storage case; our release does not yet reduce this family |

The public gas case uses a more complex prefix: a 400,000-gas VERIFY frame, an 80,000-gas DEFAULT pre-verification frame and a 60,000-gas payer VERIFY frame, plus 100 signature-verification gas. The public error reports the 540,100 total. Our local single-prefix fixture preserves the rejection class, not this complete transaction's structure or original fingerprint. The public node labels this failure `simulation`; our pinned adapter labels its local gas gate `structure`. Those stages must not be described as identical.

These are experimental sponsor-devnet records, not Ethereum-mainnet incidents. The records do not identify whether the authors intentionally generated failing tests, nor establish an unintended production bug. Admission failure typically prevents inclusion, so the appropriate evidence is the node's rejection report rather than an onchain failed receipt. Explorer history is bounded and can disappear on restart; the timestamped saved reports remain useful.

## Reproduce the supported class yourself

From the project directory, with dependencies bootstrapped and Docker running:

```sh
npm run runtime:up
npm run cli -- inspect fixtures/verify-gas.json
npm run cli -- evaluate fixtures/verify-gas.json
npm run cli -- reduce fixtures/verify-gas.json --out .runs/my-gas-reproduction
npm run cli -- replay .runs/my-gas-reproduction
```

Use a new export directory each time. Expected result: four frames / 746 bytes become two frames / 252 bytes, the gas-budget rejection remains, and replay confirms both failing variants plus the passing corrected control. The UI exposes the same flow at http://127.0.0.1:4317.

For the trace-based example, replace the fixture with `fixtures/banned-opcode.json`; the measured result is 745 to 251 bytes. Neither local experiment submits candidates or spends mainnet ETH.

## What an exact historical replay would require

A hash or admission screenshot is insufficient. Capture the complete raw signed transaction, observed rule/trace, relevant account and contract state, chain/fork rules, exact client/sidecar versions, policy configuration and stake/reputation inputs at the rejection time. The selected explorer details can retain the admission frames while having no full mempool entry: such a report is not a complete portable fixture.

An unchanged signed transaction might be replayable in an exactly reconstructed environment. Once it is edited, its canonical digest changes; production signatures cannot simply be reused or replaced without authorization. Build an owned local recipe that faithfully implements the relevant behavior and explicitly record the substitutions. Reproduce an unchanged baseline and passing control before enabling reduction. The current public-import mode is read-only and does not automate this conversion or historical-state reconstruction.

For an ordinary mainnet transaction, nested EVM calls or a multicall array are not EIP-8141 frames. A separate adapter and edit model would be needed, potentially on a mainnet fork with historical state and appropriate authorization. That capability is outside this release.

## Honest demonstration claim

“We found this validation-budget rejection on the public EIP-8141 devnet. We reproduce the same rule class in an owned, controlled fixture, reduce it with real ethrex execution and upstream validation, and replay it from clean state.”

Do not claim that we imported and automatically minimized the historical public transaction. Our successful public EOA self-relay proves live admission/execution integration separately; it is not the historical failing case with its bug fixed.

Primary references: [EIP-8141 draft](https://eips.ethereum.org/EIPS/eip-8141), [Ethereum roadmap](https://ethereum.org/roadmap/), [pinned sidecar explorer API](https://github.com/forshtat/mempool-workshop-sidecar/blob/2e22ff0a2898e69ea4bf5275bce1be8581a8582a/docs/sidecar_explorer.md).
