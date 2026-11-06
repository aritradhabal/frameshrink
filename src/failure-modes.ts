import { toFunctionSelector } from "viem";
import type { Recipe } from "./recipe.js";
import { FrameShrinkError } from "./shared.js";
export const FIXTURE_REVERT = toFunctionSelector("FrameShrinkFixtureFailure()");
// Execution-halting branches run before policy-only violations; order is intentional.
export const FAILURE_MODES = [
  {
    id: "application-revert",
    bit: 16,
    label: "Application revert (test error)",
    cause: "APPLICATION_REVERT:FrameShrinkFixtureFailure()",
    category: "application-revert",
    correction: "skip the test revert",
  },
  {
    id: "static-write",
    bit: 8,
    label: "State write during validation",
    cause: "STATIC_WRITE:VALIDATION_SSTORE",
    category: "storage",
    correction: "skip SSTORE in read-only validation",
  },
  {
    id: "timestamp",
    bit: 1,
    label: "Forbidden TIMESTAMP",
    cause: "BANNED_OPCODE:TIMESTAMP",
    category: "opcode",
    correction: "skip TIMESTAMP",
  },
  {
    id: "number",
    bit: 2,
    label: "Forbidden NUMBER",
    cause: "BANNED_OPCODE:NUMBER",
    category: "opcode",
    correction: "skip NUMBER",
  },
  {
    id: "code-access",
    bit: 4,
    label: "Code access to an undeployed account",
    cause: "CODE_ACCESS:OWNER_NO_CODE",
    category: "creation-calls-code",
    correction: "skip EXTCODESIZE on the undeployed owner",
  },
] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];
export const MAX_FAILURE_MASK = 31;
export function recipeMask(recipe: Recipe): number {
  if (recipe.family === "validation-fixture") return recipe.failureMask!;
  return recipe.family === "banned-opcode" ? (recipe.opcodeMask ?? 1) : 0;
}
export function firstFailure(recipe: Recipe): FailureMode | undefined {
  return FAILURE_MODES.find((mode) => recipeMask(recipe) & mode.bit);
}
export function failureLabel(cause: string) {
  return FAILURE_MODES.find((mode) => mode.cause === cause)?.label ?? cause;
}
export function modeLabels(mask: number) {
  return FAILURE_MODES.filter((mode) => mask & mode.bit)
    .map((mode) => mode.label)
    .join(" + ");
}
export function correctFailure(recipe: Recipe): Recipe {
  const mode = firstFailure(recipe);
  if (!mode) throw new FrameShrinkError("No selected failure to correct", 5);
  const remaining = recipeMask(recipe) & ~mode.bit;
  return {
    ...recipe,
    family: remaining ? recipe.family : "verify-gas",
    prefixGas: 30000,
    ...(recipe.failureMask !== undefined
      ? { failureMask: remaining || recipe.failureMask }
      : recipe.opcodeMask !== undefined
        ? { opcodeMask: remaining || recipe.opcodeMask }
        : {}),
  };
}
export function matchesPublicFailure(
  mode: FailureMode,
  message: string,
  owner: string,
): boolean {
  switch (mode.id) {
    case "timestamp":
      return /TIMESTAMP|BannedOpcode\(66\)/.test(message);
    case "number":
      return /NUMBER|BannedOpcode\(67\)/.test(message);
    case "application-revert":
      return message.toLowerCase().includes(FIXTURE_REVERT.toLowerCase());
    case "static-write":
      return /static_violation|StaticViolation|read.only validation|state.*read.only/i.test(
        message,
      );
    case "code-access":
      return (
        message.toLowerCase().includes(owner.toLowerCase()) &&
        /un.deployed|nonexistent|non.existent|CallToNonexistentOrDelegated/i.test(
          message,
        )
      );
  }
}
