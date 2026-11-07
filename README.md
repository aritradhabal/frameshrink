# FrameShrink

Shrink failing Ethereum frame transactions into reproducible tests.

[![npm](https://img.shields.io/npm/v/frameshrink?color=0f766e)](https://www.npmjs.com/package/frameshrink) [![MIT license](https://img.shields.io/badge/license-MIT-475569)](https://github.com/aritradhabal/frameshrink/blob/main/LICENSE)

```text
+---------+     +-----------+
| Capture | --> | Reproduce |
+---------+     +-----+-----+
                     |
                     v
+---------+     +-----------+
| Replay  | <-- |  Shrink   |
+---------+     +-----------+
```

## Quick start

```sh
npx frameshrink demo
```

**Node.js 22.13+ (22.x) or 24+ · Docker required.** The demo replays a captured case locally, including five failures and a passing correction. No wallet or funds needed.

## Use it

| Command | Purpose |
|---|---|
| `npx frameshrink start transaction` | Create a test wallet/case, debug locally, then confirm devnet submissions. |
| `npx frameshrink debug <explorer-url>` | Inspect an existing public rejection. |
| `npx frameshrink replay <case>` | Verify a saved reproduction. |

Prefer a global install? `npm install -g frameshrink`

## How shrinking works

```text
Current case
     |
     v
Remove a piece --> Replay candidate
                       |
             Smaller + same failure?
                /             \
              Yes              No
               |                |
           Keep edit       Discard edit
                \             /
                 Try next edit
```

**Recorded result:** 4 → 2 frames · 767 → 282 bytes. [View the evidence](https://github.com/aritradhabal/frameshrink/tree/main/evidence/expanded-all-five).

**Supported fixtures:** test revert, validation state write, TIMESTAMP, NUMBER and undeployed-account code access. Corrections target these controlled fixtures. An arbitrary explorer link may lack the state needed for replay.

[Setup & troubleshooting](https://github.com/aritradhabal/frameshrink/blob/main/docs/PACKAGING.md) · [CLI guide](https://github.com/aritradhabal/frameshrink/blob/main/docs/CLI-WORKFLOW.md) · [Verification](https://github.com/aritradhabal/frameshrink/blob/main/docs/VERIFICATION.md)

[Attribution & AI disclosure](https://github.com/aritradhabal/frameshrink/blob/main/docs/ATTRIBUTION.md) · [Reconstructed history](https://github.com/aritradhabal/frameshrink/blob/main/docs/HISTORY-RECONSTRUCTION.md)
