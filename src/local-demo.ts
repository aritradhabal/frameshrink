import { cp, mkdir, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { prepareRuntime } from "./environment.js";
import type { ReplayEvent } from "./demo.js";
import { ROOT, FrameShrinkError } from "./shared.js";
import { defaultDemoDirectory, replayDemo, loadDemo } from "./demo.js";
export async function localDemo(
  directory = defaultDemoDirectory(),
  progress: (event: ReplayEvent) => void = () => {},
) {
  try {
    await lstat(directory);
    throw new FrameShrinkError(
      "Output directory already exists; choose a new --out directory",
      2,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await prepareRuntime({
    onProgress: (message) => progress({ kind: "phase", message }),
  });
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  const source = ROOT + "examples/expanded-all-five";
  for (const file of await readdir(source))
    await cp(path.join(source, file), path.join(directory, file), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const run = await loadDemo(directory);
  const replay = await replayDemo(directory, progress);
  return {
    ...replay,
    directory,
    originalFrames: run.originalFrames,
    reducedFrames: run.reducedFrames,
    originalBytes: run.originalBytes,
    reducedBytes: run.reducedBytes,
    networkWrites: false,
  };
}
