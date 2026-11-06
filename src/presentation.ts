import { safe, terminal } from "./terminal.js";
import type { DemoRun, ReplayEvent } from "./demo.js";
import { failureLabel } from "./failure-modes.js";

export function balanceLabel(value: string | null): string {
  if (value === null) return "Balance unavailable";
  const [whole, fraction = ""] = value.split(".");
  const compact = fraction.slice(0, 6).replace(/0+$/, "");
  if (whole === "0" && !compact && /[1-9]/.test(fraction))
    return "<0.000001 ETH";
  return `${whole}${compact ? "." + compact : ""} ETH`;
}
export function reductionMetrics(
  run: Pick<
    DemoRun,
    "originalFrames" | "reducedFrames" | "originalBytes" | "reducedBytes"
  >,
  color?: boolean,
) {
  const ui = terminal(color);
  const reduction =
    run.originalBytes && run.reducedBytes !== undefined
      ? ` · ${((1 - run.reducedBytes / run.originalBytes) * 100).toFixed(1)}% smaller`
      : "";
  return `${ui.dim("Frames")} ${run.originalFrames} → ${ui.green(run.reducedFrames)}  ${ui.dim("Bytes")} ${run.originalBytes} → ${ui.green(run.reducedBytes)}${ui.dim(reduction)}`;
}
export function transactionResult(run: DemoRun, color?: boolean): string {
  const ui = terminal(color);
  const label =
    run.state === "complete"
      ? "ACCEPTED"
      : run.state === "pending"
        ? "PENDING"
        : "UNCONFIRMED";
  return `${ui.badge(label, run.state === "complete" ? "green" : "yellow")} ${ui.cyan(run.correctedHash)}`;
}
export function replayLine(
  event: ReplayEvent,
  color?: boolean,
): string | undefined {
  const ui = terminal(color);
  if (event.kind !== "stage") return undefined;
  return `  ${ui.dim(`${event.index}/${event.total}`)} ${safe(failureLabel(event.failure)).padEnd(38)} ${ui.green("✓ verified")}`;
}
export function caseHeading(
  mask: number,
  index: number,
  total: number,
  color?: boolean,
): string {
  const ui = terminal(color);
  let count = 0;
  for (let bits = mask; bits; bits >>= 1) count += bits & 1;
  return `${ui.badge("CASE")} ${index}/${total} ${ui.dim("·")} ${count} selected failure${count === 1 ? "" : "s"}`;
}
export function fitChoiceLabel(
  name: string,
  disabled: string | undefined,
  width = 80,
): string {
  if (!disabled) return name;
  const maximum = Math.max(12, width - [...disabled].length - 5);
  const letters = [...name];
  return letters.length > maximum
    ? letters.slice(0, maximum - 1).join("") + "…"
    : name;
}

// Only animate genuine work. The content is always sanitized; ANSI here is renderer-owned.
export function activity(
  initial: string,
  options: { color?: boolean; enabled?: boolean } = {},
) {
  const ui = terminal(options.color);
  const animate = options.enabled !== false && !!process.stdout.isTTY;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let label = initial,
    index = 0,
    active = true;
  const clear = () => {
    if (animate) process.stdout.write("\r\x1b[2K");
  };
  const render = () => {
    if (animate && active)
      process.stdout.write(
        `\r\x1b[2K${ui.cyan(frames[index++ % frames.length])} ${safe(label)}`,
      );
  };
  render();
  const timer = animate ? setInterval(render, 90) : undefined;
  timer?.unref();
  return {
    update(value: string) {
      label = value;
      render();
    },
    log(value: string) {
      clear();
      process.stdout.write(value + "\n");
      render();
    },
    stop() {
      active = false;
      if (timer) clearInterval(timer);
      clear();
    },
  };
}
export async function withActivity<T>(
  label: string,
  operation: () => Promise<T>,
  color?: boolean,
): Promise<T> {
  const indicator = activity(label, { color });
  try {
    return await operation();
  } finally {
    indicator.stop();
  }
}
