export const safe = (value: unknown) =>
  String(value).replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
export function terminal(enabled?: boolean) {
  const color =
    enabled ??
    (!("NO_COLOR" in process.env) &&
      process.env.FORCE_COLOR !== "0" &&
      (!!process.stdout.isTTY || !!process.env.FORCE_COLOR));
  const wrap = (code: number, value: unknown) =>
    color ? `\x1b[${code}m${safe(value)}\x1b[0m` : safe(value);
  return {
    badge: (
      value: unknown,
      tone: "cyan" | "green" | "yellow" | "red" = "cyan",
    ) => {
      const background = { cyan: 46, green: 42, yellow: 43, red: 41 }[tone];
      return color
        ? `\x1b[${background};${tone === "red" ? 97 : 30};1m ${safe(value)} \x1b[0m`
        : `[${safe(value)}]`;
    },
    green: (v: unknown) => wrap(32, v),
    red: (v: unknown) => wrap(31, v),
    yellow: (v: unknown) => wrap(33, v),
    cyan: (v: unknown) => wrap(36, v),
    dim: (v: unknown) => wrap(90, v),
    bold: (v: unknown) => wrap(1, v),
    ok: (v: unknown) => `${wrap(32, "✓")} ${safe(v)}`,
    warn: (v: unknown) => `${wrap(33, "!")} ${safe(v)}`,
    error: (v: unknown) => `${wrap(31, "✖")} ${safe(v)}`,
  };
}
