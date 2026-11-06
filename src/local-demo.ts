import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./shared.js";
import { defaultDemoDirectory, replayDemo, loadDemo } from "./demo.js";
export async function localDemo(directory = defaultDemoDirectory()) {
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
  const replay = await replayDemo(directory);
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
