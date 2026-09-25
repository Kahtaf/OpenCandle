import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Exercise the shipped CLI, including its exit status, against a real offline HTTP server.
async function runChecker(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  // Requests stay local; a child-process fetch adapter maps the fixture hostname below.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server port");
  const root = mkdtempSync(join(tmpdir(), "oc-doc-links-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "website/dist"), { recursive: true });
    for (const file of ["check-public-doc-links.mjs", "check-public-doc-links-lib.mjs"]) {
      copyFileSync(
        fileURLToPath(new URL(`../../scripts/${file}`, import.meta.url)),
        join(root, "scripts", file),
      );
    }
    writeFileSync(
      join(root, "website/dist/index.html"),
      '<a href="http://fixture.test/guide">Guide</a>',
    );
    const preload = join(root, "fixture-fetch.mjs");
    writeFileSync(
      preload,
      `
      const realFetch = globalThis.fetch;
      globalThis.fetch = (url, options) => {
        const parsed = new URL(url);
        if (parsed.hostname !== "fixture.test") throw new Error("Unexpected external request");
        return realFetch("http://127.0.0.1:${address.port}" + parsed.pathname, options);
      };
    `,
    );
    const child = spawn(
      process.execPath,
      ["--import", preload, join(root, "scripts/check-public-doc-links.mjs")],
      {
        env: {
          ...process.env,
          OPENCANDLE_LINK_CHECK_ATTEMPTS: "3",
          OPENCANDLE_LINK_CHECK_RETRY_DELAY_MS: "1",
          OPENCANDLE_LINK_CHECK_TIMEOUT_MS: "1000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const [code] = await once(child, "close");
    return { code, output };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

describe("public docs link release gate", () => {
  it("recovers from HTTP 503 within the budget and preserves the failed attempt", async () => {
    let requests = 0;
    const result = await runChecker((_req, res) => {
      res.writeHead(++requests === 1 ? 503 : 200).end();
    });
    expect(result.code, result.output).toBe(0);
    expect(requests).toBe(2);
    expect(result.output).toContain("HTTP 503");
    expect(result.output).toContain("Checked 1 public docs external link(s).");
  });

  it("fails after exactly three HTTP 503 attempts", async () => {
    let requests = 0;
    const result = await runChecker((_req, res) => {
      requests += 1;
      res.writeHead(503).end();
    });
    expect(result.code, result.output).toBe(1);
    expect(requests).toBe(3);
    expect(result.output).toContain("HTTP 503");
    expect(result.output).not.toContain("Checked 1");
  });

  it("fails rather than skipping exhausted HEAD and GET transport failures", async () => {
    const methods: string[] = [];
    const result = await runChecker((req) => {
      methods.push(req.method ?? "");
      req.socket.destroy();
    });
    expect(result.code, result.output).toBe(1);
    expect(methods).toEqual(["HEAD", "GET", "HEAD", "GET", "HEAD", "GET"]);
    expect(result.output).toContain("Public docs link check failed");
    expect(result.output).not.toContain("Skipped");
  });

  it("fails a definitive 404 without retrying", async () => {
    let requests = 0;
    const result = await runChecker((_req, res) => {
      requests += 1;
      res.writeHead(404).end();
    });
    expect(result.code, result.output).toBe(1);
    expect(requests).toBe(1);
    expect(result.output).toContain("HTTP 404");
  });

  it("verifies by GET when HEAD enters a redirect loop", async () => {
    const methods: string[] = [];
    const result = await runChecker((req, res) => {
      methods.push(req.method ?? "");
      if (req.method === "HEAD") res.writeHead(302, { Location: "/guide" }).end();
      else res.writeHead(200).end();
    });
    expect(result.code, result.output).toBe(0);
    expect(methods.filter((method) => method === "GET")).toHaveLength(1);
    expect(methods.filter((method) => method === "HEAD").length).toBeLessThanOrEqual(21);
    expect(result.output).toContain("Checked 1 public docs external link(s).");
  });
});
