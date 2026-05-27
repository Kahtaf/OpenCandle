import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT ?? 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function resolvePath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(root, normalized === "/" ? "index.html" : normalized.slice(1)));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

const server = createServer(async (req, res) => {
  const candidate = resolvePath(req.url ?? "/");
  if (!candidate) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(candidate);
    const file = info.isDirectory() ? join(candidate, "index.html") : candidate;
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenCandle docs site: http://127.0.0.1:${port}`);
});
