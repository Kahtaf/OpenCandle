import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("provider relay privacy audit", () => {
  it("configures no application logging, storage, analytics, or public workers.dev route", () => {
    const config = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
    expect(config).toContain('"workers_dev": false');
    expect(config).toContain('"invocation_logs": false');
    expect(config).toContain('"observability"');
    expect(config).toContain('"enabled": false');
    for (const forbidden of [
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "durable_objects",
      "analytics_engine_datasets",
      "queues",
      "tail_consumers",
      "logpush",
    ]) {
      expect(config).not.toContain(forbidden);
    }
  });

  it("routes only the four exact production endpoints", () => {
    const config = JSON.parse(
      readFileSync(resolve(root, "wrangler.jsonc"), "utf8"),
    ) as { routes?: Array<{ pattern?: string }> };
    expect(config.routes?.map((route) => route.pattern)).toEqual([
      "https://web.opencandle.app/v1/provider-fetch",
      "https://web.opencandle.app/v1/model-fetch",
      "https://web.opencandle.app/v1/health",
      "https://web.opencandle.app/v1/runtime-token",
    ]);
  });

  it("contains no logging, Cache API, or error reflection in production source", () => {
    const source = ["relay.ts", "worker.ts"]
      .map((file) => readFileSync(resolve(root, "src", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/console\s*\./);
    expect(source).not.toMatch(/\bcaches\s*\./);
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("String(error)");
    expect(source).not.toContain("request.cf");
    expect(source).toContain('crypto.subtle.digest("SHA-256"');
    expect(source).not.toContain("key: clientId");
    expect(source).not.toContain("key: connectingIp");
  });
});
