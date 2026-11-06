import { z } from "zod";
import {
  decodeFrameTx,
  encodeRawFrameTx,
} from "../.vendor/sidecar/packages/executor/lib/services/FrameTxService/codec.js";
import { frameTxNonceAndRootsViolation } from "../.vendor/sidecar/packages/types/lib/contracts/FrameTx.js";
import {
  recognizeValidationPrefix,
  validateStructuralRules,
} from "../.vendor/sidecar/packages/executor/lib/services/UserOpValidation/utils/validationPrefix.js";
import { FrameShrinkError } from "./shared.js";
const schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("imported"),
    raw: z
      .string()
      .max(524288)
      .regex(/^0x06(?:[a-fA-F0-9]{2})+$/),
  })
  .strict();
export function inspectImported(v: unknown) {
  try {
    const { raw } = schema.parse(v);
    const tx = decodeFrameTx(Buffer.from(raw.slice(4), "hex"));
    if (encodeRawFrameTx(tx).toLowerCase() !== raw.toLowerCase())
      throw Error("Noncanonical encoding");
    if (
      tx.frames.length < 1 ||
      tx.frames.length > 64 ||
      tx.signatures.length > 64
    )
      throw Error("Array bounds exceeded");
    const error = frameTxNonceAndRootsViolation(tx);
    if (error) throw Error(error);
    const prefix = recognizeValidationPrefix(tx.frames, tx.sender);
    const structural = prefix
      ? validateStructuralRules(tx, prefix)
      : { valid: false, reason: "Unrecognized validation prefix" };
    return {
      diagnostics: {
        prefixRecognized: !!prefix,
        structural,
        scope:
          "Static prefix/structural checks only; signature, execution and live admission not evaluated",
      },
      schemaVersion: 1,
      mode: "imported",
      permission: "read-only",
      reproducibility: "diagnostic-only; external state unavailable",
      bytes: (raw.length - 2) / 2,
      frameCount: tx.frames.length,
      chainId: "0x" + tx.chainId.toString(16),
      sender: tx.sender,
      transaction: tx,
    };
  } catch (e) {
    throw new FrameShrinkError(
      "Invalid imported payload: " + (e as Error).message,
      2,
    );
  }
}
