import { open, mkdir, unlink } from "node:fs/promises";
import { DATA_DIRECTORY, FrameShrinkError } from "./shared.js";
export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  let handle;
  try {
    handle = await open(DATA_DIRECTORY + "/runtime.lock", "wx");
  } catch {
    throw new FrameShrinkError(
      "Another FrameShrink job owns the runtime. Close it before starting another simulation.",
      4,
    );
  }
  try {
    await handle.writeFile(String(process.pid));
    return await fn();
  } finally {
    await handle.close();
    await unlink(DATA_DIRECTORY + "/runtime.lock");
  }
}
