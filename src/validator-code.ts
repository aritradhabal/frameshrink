import { type Hex, toHex, concat } from "viem";
import { FIXTURE_REVERT } from "./failure-modes.js";
import { FrameShrinkError } from "./shared.js";
export const VALIDATOR_FUNDING = 10000000000000000n;
type Op =
  | number
  | string
  | { label: string }
  | { jump: string }
  | { bytes: number[] };
export type ValidatorVersion = 1 | 2 | 3;
// Numbers emit PUSH1; labels emit JUMPDEST. Signature metadata is protocol-validated.
export function validatorRuntime(
  owner: string,
  version: ValidatorVersion = 1,
): Hex {
  if (!/^0x[0-9a-f]{40}$/i.test(owner))
    throw new FrameShrinkError("Invalid validator owner", 2);
  const ownerBytes = Array.from(Buffer.from(owner.slice(2), "hex"));
  const ops: Record<string, number> = {
    CALLER: 0x33,
    EQ: 0x14,
    ISZERO: 0x15,
    JUMPI: 0x57,
    STOP: 0x00,
    SIGPARAM: 0xb4,
    CALLDATALOAD: 0x35,
    TIMESTAMP: 0x42,
    NUMBER: 0x43,
    AND: 0x16,
    POP: 0x50,
    APPROVE: 0xaa,
    REVERT: 0xfd,
    MSTORE: 0x52,
    SSTORE: 0x55,
    EXTCODESIZE: 0x3b,
  };
  const program: Op[] = [
    "CALLER",
    0xaa,
    "EQ",
    { jump: "verify" },
    "JUMPI",
    "STOP",
    { label: "verify" },
    0,
    0,
    "SIGPARAM",
    "OWNER",
    "EQ",
    "ISZERO",
    { jump: "fail" },
    "JUMPI",
    2,
    0,
    "SIGPARAM",
    "ISZERO",
    "ISZERO",
    { jump: "fail" },
    "JUMPI",
    1,
    0,
    "SIGPARAM",
    1,
    "EQ",
    "ISZERO",
    { jump: "fail" },
    "JUMPI",
    ...((version === 3
      ? [
          0,
          "CALLDATALOAD",
          16,
          "AND",
          "ISZERO",
          { jump: "static" },
          "JUMPI",
          { bytes: Array.from(Buffer.from(FIXTURE_REVERT.slice(2), "hex")) },
          0,
          "MSTORE",
          4,
          28,
          "REVERT",
          { label: "static" },
          0,
          "CALLDATALOAD",
          8,
          "AND",
          "ISZERO",
          { jump: "policy" },
          "JUMPI",
          1,
          0,
          "SSTORE",
          { label: "policy" },
        ]
      : []) as Op[]),
    ...((version === 1
      ? [
          0,
          "CALLDATALOAD",
          "ISZERO",
          { jump: "approve" },
          "JUMPI",
          "TIMESTAMP",
          "POP",
        ]
      : [
          0,
          "CALLDATALOAD",
          1,
          "AND",
          "ISZERO",
          { jump: "number" },
          "JUMPI",
          "TIMESTAMP",
          "POP",
          { label: "number" },
          0,
          "CALLDATALOAD",
          2,
          "AND",
          "ISZERO",
          { jump: "approve" },
          "JUMPI",
          "NUMBER",
          "POP",
        ]) as Op[]),
    ...((version === 3
      ? [
          { label: "approve" },
          0,
          "CALLDATALOAD",
          4,
          "AND",
          "ISZERO",
          { jump: "finish" },
          "JUMPI",
          "OWNER",
          "EXTCODESIZE",
          "POP",
          { label: "finish" },
        ]
      : [{ label: "approve" }]) as Op[]),
    3,
    0,
    0,
    "APPROVE",
    { label: "fail" },
    0,
    0,
    "REVERT",
  ];
  const labels = new Map<string, number>();
  const encode = (resolve: boolean) => {
    const bytes: number[] = [];
    for (const op of program) {
      if (typeof op === "number") bytes.push(0x60, op);
      else if (typeof op === "string") {
        if (op === "OWNER") bytes.push(0x73, ...ownerBytes);
        else bytes.push(ops[op]);
      } else if ("label" in op) {
        labels.set(op.label, bytes.length);
        bytes.push(0x5b);
      } else if ("bytes" in op) bytes.push(0x5f + op.bytes.length, ...op.bytes);
      else {
        const target = resolve ? labels.get(op.jump)! : 0;
        if (target > 255)
          throw new FrameShrinkError("Validator jump exceeds PUSH1", 3);
        bytes.push(0x60, target);
      }
    }
    return bytes;
  };
  encode(false);
  return toHex(new Uint8Array(encode(true)));
}
export function validatorInit(
  owner: string,
  version: ValidatorVersion = 1,
): Hex {
  const runtime = validatorRuntime(owner, version),
    size = (runtime.length - 2) / 2;
  if (size > 255)
    throw new FrameShrinkError(
      "Validator runtime exceeds fixed init-code limit",
      3,
    );
  return concat([
    toHex(
      new Uint8Array([
        0x60,
        size,
        0x60,
        12,
        0x60,
        0,
        0x39,
        0x60,
        size,
        0x60,
        0,
        0xf3,
      ]),
    ),
    runtime,
  ]);
}
