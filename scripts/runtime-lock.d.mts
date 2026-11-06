export const RUNTIME_LOCK_DIRECTORY: string;
export class RuntimeLockError extends Error {}
export function withRuntimeLock<T>(
  fn: () => Promise<T>,
  options?: { directory?: string },
): Promise<T>;
