import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IMAGE, FrameShrinkError } from "./shared.js";
const execute = promisify(execFile);
export type DockerRunner = (args: string[], timeout: number) => Promise<void>;
const docker: DockerRunner = async (args, timeout) => {
  await execute("docker", args, { timeout, maxBuffer: 8 * 1024 * 1024 });
};
export async function prepareRuntime(
  options: {
    onProgress?: (message: string) => void;
    run?: DockerRunner;
  } = {},
) {
  const run = options.run ?? docker;
  options.onProgress?.("Checking Docker");
  try {
    await run(["info", "--format", "{{.ServerVersion}}"], 5000);
  } catch (e) {
    throw new FrameShrinkError(
      (e as NodeJS.ErrnoException).code === "ENOENT"
        ? "Docker is required for simulation. Install Docker, start it, and retry."
        : "Docker is not responding. Start Docker and check access, then retry.",
      3,
    );
  }
  try {
    await run(["image", "inspect", IMAGE], 5000);
  } catch {
    options.onProgress?.("Downloading pinned execution image · first run");
    try {
      await run(["pull", IMAGE], 180000);
    } catch {
      throw new FrameShrinkError(
        "Could not download the execution image. Check your connection and Docker, then retry.",
        3,
      );
    }
  }
}
