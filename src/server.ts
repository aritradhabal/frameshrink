import { pathToFileURL } from "node:url";
import { manageRuntime } from "../scripts/runtime.mjs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import {
  ROOT,
  DATA_DIRECTORY,
  json,
  readJSON,
  FrameShrinkError,
} from "./shared.js";
import { capture } from "./runtime.js";
import { parseRecipe } from "./recipe.js";
import { reduce, type Reduction, type Attempt } from "./reducer.js";
import { exportBundle, replay } from "./bundle.js";
import { exclusive } from "./lock.js";
import { inspectImported } from "./imported.js";
export function createWorkbenchServer(port = 4317) {
  const PORT = port,
    token = randomBytes(32).toString("hex");
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  type Job = {
    id: string;
    status: "running" | "complete" | "error";
    progress: Attempt[];
    result?: Reduction;
    error?: string;
    bundle?: string;
    replay?: unknown;
  };
  const jobs = new Map<string, Job>();
  let busy = false;
  function send(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(json(data));
  }
  async function body(req: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 262144) throw new FrameShrinkError("Input exceeds 256 KiB", 2);
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new FrameShrinkError("Invalid JSON", 2);
    }
  }
  function mutate(req: IncomingMessage) {
    if (
      req.headers["x-frameshrink-token"] !== token ||
      req.headers.origin !== `http://${req.headers.host}`
    )
      throw new FrameShrinkError(
        "Session token and matching origin required",
        2,
      );
  }
  const server = createServer(async (req, res) => {
    try {
      if (!hosts.has(req.headers.host ?? "")) {
        send(res, 403, { error: "Unrecognized host" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/") {
        const page = (await readFile(ROOT + "src/ui.html", "utf8")).replace(
          "__SESSION_TOKEN__",
          token,
        );
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          "x-content-type-options": "nosniff",
        });
        res.end(page);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/info") {
        send(res, 200, {
          schemaVersion: 1,
          profile: await capture(),
          fixtures: await Promise.all(
            ["verify-gas", "banned-opcode"].map(async (f) =>
              readJSON(ROOT + `fixtures/${f}.json`),
            ),
          ),
        });
        return;
      }
      if (
        req.method === "GET" &&
        /^\/api\/jobs\/[a-f0-9-]+$/.test(url.pathname)
      ) {
        const job = jobs.get(url.pathname.split("/").at(-1)!);
        send(res, job ? 200 : 404, job ?? { error: "Job not found" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/inspect") {
        mutate(req);
        const input = await body(req);
        send(
          res,
          200,
          input.mode === "imported"
            ? inspectImported(input)
            : { mode: "owned", recipe: parseRecipe(input) },
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/reduce") {
        mutate(req);
        if (busy) {
          send(res, 409, { error: "A runtime job is already active" });
          return;
        }
        const recipe = parseRecipe(await body(req));
        busy = true;
        const job: Job = { id: randomUUID(), status: "running", progress: [] };
        if (jobs.size >= 20) {
          const oldest = [...jobs.values()].find((j) => j.status !== "running");
          if (oldest) jobs.delete(oldest.id);
        }
        jobs.set(job.id, job);
        send(res, 202, { id: job.id });
        void exclusive(async () => {
          job.result = await reduce(recipe, await capture(), undefined, (a) =>
            job.progress.push(a),
          );
          job.status = "complete";
        })
          .catch((e) => {
            job.status = "error";
            job.error = (e as Error).message;
          })
          .finally(() => {
            busy = false;
          });
        return;
      }
      if (
        req.method === "POST" &&
        /^\/api\/jobs\/[a-f0-9-]+\/(export|replay)$/.test(url.pathname)
      ) {
        mutate(req);
        const [, , , id, action] = url.pathname.split("/");
        const job = jobs.get(id);
        if (!job?.result)
          throw new FrameShrinkError("Completed job required", 2);
        if (busy) throw new FrameShrinkError("Runtime busy");
        busy = true;
        try {
          if (!job.bundle) {
            await mkdir(DATA_DIRECTORY + "/exports", { recursive: true });
            const directory = DATA_DIRECTORY + "/exports/" + job.id;
            await exportBundle(job.result, directory);
            job.bundle = directory;
          }
          if (action === "replay")
            job.replay = await exclusive(async () => {
              await manageRuntime("up");
              return replay(job.bundle!);
            });
          send(res, 200, {
            path: job.bundle,
            replay: job.replay,
            command: `npm run cli -- replay ${JSON.stringify(job.bundle)}`,
          });
        } finally {
          busy = false;
        }
        return;
      }
      send(res, 404, { error: "Not found" });
    } catch (e) {
      send(res, e instanceof FrameShrinkError && e.exitCode === 2 ? 400 : 503, {
        error: (e as Error).message,
      });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.once("listening", () => {
    const address = server.address();
    if (address && typeof address === "object") {
      hosts.add(`127.0.0.1:${address.port}`);
      hosts.add(`localhost:${address.port}`);
    }
  });
  return server;
}
export async function startWorkbench(
  options: {
    port?: number;
    machine?: boolean;
    output?: (message: string) => void;
  } = {},
) {
  const port = options.port ?? 4317;
  const server = createWorkbenchServer(port);
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        new FrameShrinkError(
          error.code === "EADDRINUSE"
            ? `Workbench port ${port} is in use. Close the other workbench and retry.`
            : `Workbench could not start (${error.code ?? "network error"}).`,
          3,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;
  (options.output ?? console.log)(
    options.machine
      ? json({ schemaVersion: 1, status: "ready", url })
      : `FrameShrink: ${url}`,
  );
  return server;
}
if (
  process.argv[1]?.endsWith("server.ts") &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await startWorkbench();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = error instanceof FrameShrinkError ? error.exitCode : 4;
  }
}
