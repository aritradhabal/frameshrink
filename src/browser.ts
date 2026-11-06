import { spawn } from "node:child_process";
import { DEVNET } from "./devnet.js";

export type BrowserPolicy = {
  disabled?: boolean;
  machine?: boolean;
  stdinTTY?: boolean;
  stdoutTTY?: boolean;
  env?: NodeJS.ProcessEnv;
};

const enabledValue = (value: string | undefined) =>
  !!value && !["0", "false"].includes(value.toLowerCase());

export function browserEnabled(options: BrowserPolicy = {}): boolean {
  const env = options.env ?? process.env;
  return (
    !options.disabled &&
    !options.machine &&
    (options.stdinTTY ?? !!process.stdin.isTTY) &&
    (options.stdoutTTY ?? !!process.stdout.isTTY) &&
    !enabledValue(env.CI) &&
    !enabledValue(env.FRAMESHRINK_NO_OPEN) &&
    env.TERM !== "dumb"
  );
}

export function browserCommand(
  value: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  const url = new URL(value);
  const node = url.searchParams.get("node");
  if (
    url.origin !== "https://explorer.altmempool.wtf" ||
    url.username ||
    url.password ||
    url.hash ||
    !/^(?:\/|\/tx\/0x[0-9a-fA-F]{64}\/?)$/.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => key !== "node") ||
    url.searchParams.getAll("node").length > 1 ||
    (node !== null && node !== DEVNET.rpc && node !== DEVNET.primary)
  )
    throw new Error(
      "Only supported devnet explorer links can open automatically",
    );
  const target = url.href;
  if (platform === "darwin") return { command: "open", args: [target] };
  if (platform === "win32")
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", target],
    };
  return { command: "xdg-open", args: [target] };
}

export type BrowserLauncher = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<void>;

const launchBrowser: BrowserLauncher = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A timed-out desktop launcher must not keep the CLI running.
      child.unref();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error("Browser launcher timed out"));
      child.kill();
    }, timeoutMs);
    // Keep an error listener after timeout: a late launcher error is nonfatal.
    child.on("error", finish);
    child.once("exit", (code) =>
      finish(code === 0 ? undefined : new Error("Browser launcher failed")),
    );
  });

export async function openExplorer(
  url: string,
  options: BrowserPolicy & {
    launch?: BrowserLauncher;
    platform?: NodeJS.Platform;
  } = {},
): Promise<{ opened: boolean; warning?: string }> {
  if (!browserEnabled(options)) return { opened: false };
  try {
    const { command, args } = browserCommand(url, options.platform);
    await (options.launch ?? launchBrowser)(command, args, 4000);
    return { opened: true };
  } catch {
    return {
      opened: false,
      warning: "Could not open the browser · use the link above",
    };
  }
}
