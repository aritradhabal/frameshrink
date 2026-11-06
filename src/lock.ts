import { randomBytes } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DATA_DIRECTORY, FrameShrinkError } from "./shared.js";

type Owner = { pid: number; token?: string };
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
const occupied = () =>
  new FrameShrinkError(
    "Another FrameShrink job owns the runtime. Close it before starting another simulation.",
    4,
  );
function owner(value: string): Owner | undefined {
  try {
    const parsed = JSON.parse(value);
    const result = typeof parsed === "number" ? { pid: parsed } : parsed;
    if (
      result &&
      Number.isSafeInteger(result.pid) &&
      result.pid > 0 &&
      (result.token === undefined || /^[a-f0-9]{32}$/.test(result.token))
    )
      return result;
  } catch {}
  return undefined;
}
function dead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM and unexpected errors leave ownership unknown, never stale.
    return code(error) === "ESRCH";
  }
}
async function readOwner(file: string): Promise<Owner | undefined> {
  try {
    return owner(await readFile(file, "utf8"));
  } catch (error) {
    if (code(error) === "ENOENT") return undefined;
    throw error;
  }
}
async function removeEmpty(directory: string) {
  try {
    await rmdir(directory);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(code(error) ?? ""))
      throw error;
  }
}

export async function exclusive<T>(
  fn: () => Promise<T>,
  options: { directory?: string } = {},
): Promise<T> {
  const directory = options.directory ?? DATA_DIRECTORY;
  const lock = path.join(directory, "runtime.lock");
  const guard = lock + ".d";
  const token = randomBytes(16).toString("hex");
  const filename = `owner-${token}.json`;
  const identity = { pid: process.pid, token };
  let staging: string | undefined;
  let acquired = false;
  let fileOwned = false;
  let entered = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    staging = await mkdtemp(path.join(directory, ".runtime-lock-"));
    const prepared = staging;
    await writeFile(path.join(staging, filename), JSON.stringify(identity), {
      flag: "wx",
      mode: 0o600,
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        // Install a nonempty directory atomically: a new owner is never empty.
        await rename(prepared, guard);
        staging = undefined;
        acquired = true;
        break;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(code(error) ?? "")) throw error;
      }
      let entries: string[];
      try {
        entries = await readdir(guard);
      } catch (error) {
        if (code(error) === "ENOENT") continue;
        throw error;
      }
      if (!entries.length) {
        await removeEmpty(guard);
        continue;
      }
      if (
        entries.length !== 1 ||
        !/^owner-[a-f0-9]{32}\.json$/.test(entries[0])
      )
        throw occupied();
      const previous = await readOwner(path.join(guard, entries[0]));
      if (!previous) throw occupied();
      if (entries[0] !== `owner-${previous.token}.json` || !dead(previous.pid))
        throw occupied();
      try {
        // A competing recovery can replace the directory, but never this token.
        await unlink(path.join(guard, entries[0]));
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
      }
      // A replacement owner's nonempty directory cannot be removed here.
      await removeEmpty(guard);
    }
    if (!acquired) throw occupied();
    // Keep the legacy PID-file protocol, protected by the owner directory.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        // Link a complete record: crashes cannot leave a half-written PID file.
        await link(path.join(guard, filename), lock);
        fileOwned = true;
        break;
      } catch (error) {
        if (code(error) !== "EEXIST") throw error;
        const previous = await readOwner(lock);
        if (!previous || !dead(previous.pid)) throw occupied();
        await unlink(lock);
      }
    }
    if (!fileOwned) throw occupied();
    entered = true;
    return await fn();
  } catch (error) {
    if (entered || error instanceof FrameShrinkError) throw error;
    throw new FrameShrinkError(
      `Could not access the runtime lock (${code(error) ?? "filesystem error"}). Check data directory permissions.`,
      4,
    );
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (acquired) {
      if (fileOwned && (await readOwner(lock))?.token === token)
        await unlink(lock);
      if ((await readOwner(path.join(guard, filename)))?.token === token)
        await unlink(path.join(guard, filename));
      await removeEmpty(guard);
    }
  }
}
