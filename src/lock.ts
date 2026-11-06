import { withRuntimeLock, RuntimeLockError } from "../scripts/runtime-lock.mjs";
import { FrameShrinkError } from "./shared.js";

// Wallet/case directories never determine ownership of the shared Docker runtime.
export async function exclusive<T>(
  fn: () => Promise<T>,
  options: { directory?: string } = {},
): Promise<T> {
  try {
    return await withRuntimeLock(fn, options);
  } catch (error) {
    if (error instanceof RuntimeLockError)
      throw new FrameShrinkError(error.message, 4);
    throw error;
  }
}
