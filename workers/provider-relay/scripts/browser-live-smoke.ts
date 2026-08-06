import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const relayUrl =
  process.env.OPENCANDLE_PROVIDER_RELAY_URL?.trim() ||
  "https://web.opencandle.app/v1/provider-fetch";
const hostedAppUrl =
  process.env.OPENCANDLE_HOSTED_APP_URL?.trim() || new URL("/", relayUrl).toString();
const args = {
  clientId: randomBytes(16).toString("hex"),
  keys: {
    alphaVantage: String(process.env.ALPHA_VANTAGE_API_KEY || "").trim(),
    brave: String(process.env.BRAVE_API_KEY || "").trim(),
    exa: String(process.env.EXA_API_KEY || "").trim(),
    fred: String(process.env.FRED_API_KEY || "").trim(),
    openai: String(process.env.OPENAI_API_KEY || "").trim(),
  },
  openaiModel:
    String(process.env.OPENCANDLE_RELAY_SMOKE_OPENAI_MODEL || "").trim() || "gpt-5.4-mini",
  relayUrl,
};

interface BrowserProof {
  provider: string;
  status: "PASS" | "FAIL" | "SKIP";
  reason?: string;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const proofPageUrl = new URL("/__opencandle-relay-smoke__", hostedAppUrl).toString();
  await page.route(proofPageUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>OpenCandle relay smoke</title>",
    }),
  );
  await page.goto(proofPageUrl, { waitUntil: "domcontentloaded" });
  await page.unroute(proofPageUrl);
  const serializedArgs = JSON.stringify(args).replaceAll("<", "\\u003c");
  await page.evaluate(`globalThis.__opencandleRelayProofArgs = ${serializedArgs}`);
  const browserProgram = await readFile(
    new URL("./browser-live-smoke-page.js", import.meta.url),
    "utf8",
  );
  const proofs = (await page.evaluate(browserProgram)) as BrowserProof[];

  for (const proof of proofs) {
    process.stdout.write(
      `${proof.status.padEnd(4)} ${proof.provider}${proof.reason ? ` ${proof.reason}` : ""}\n`,
    );
  }
  const failures = proofs.filter((proof) => proof.status === "FAIL");
  const skipped = proofs.filter((proof) => proof.status === "SKIP");
  process.stdout.write(
    `SUMMARY pass=${proofs.length - failures.length - skipped.length} fail=${failures.length} skip=${skipped.length}\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
