import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const sentinel = "browser-runtime-sentinel-credential";
const server = spawn(
  "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: new URL("..", import.meta.url),
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

let browser;
try {
  await waitForServer(origin, 30_000);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const capturedErrors = [];
  page.on("pageerror", (error) => {
    capturedErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") capturedErrors.push(message.text());
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  if (!(await page.evaluate(() => globalThis.crossOriginIsolated))) {
    throw new Error("Static host is not cross-origin isolated");
  }

  await page.locator("#model-key").fill(sentinel);
  await page.getByRole("button", { name: "Save key on this device" }).click();
  await expectText(page.locator("#saved-indicator"), "Saved on this device");
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.locator("#model-key").inputValue()) !== "") {
    throw new Error("Restored credential was pre-populated into the password input");
  }
  await expectText(page.locator("#saved-indicator"), "Saved on this device");
  if ((await page.locator("body").innerText()).includes(sentinel)) {
    throw new Error("Sentinel credential appeared in visible page text");
  }

  const ambientModel = selectAmbientModel(process.env);
  if (ambientModel) {
    await page.locator("#provider").selectOption(ambientModel.provider);
    await page.locator("#model-key").fill(ambientModel.key);
    await page.getByRole("button", { name: "Save key on this device" }).click();
  }

  const bootStarted = Date.now();
  await page.getByRole("button", { name: "Boot browser runtime" }).click();
  await expectRuntimeReady(page, 120_000);
  const bootMs = Date.now() - bootStarted;
  const health = JSON.parse(await page.locator("#health-result").innerText());
  if (typeof health.nodeVersion !== "string" || !health.nodeVersion.startsWith("v")) {
    throw new Error("WebContainer health did not report a Node version");
  }
  if (JSON.stringify(health).includes(sentinel)) {
    throw new Error("Sentinel credential appeared in health response");
  }
  await assertBridgeRejectsInvalidMessages(page);

  await page.getByRole("button", { name: "Run keyless provider probe" }).click();
  await waitForProbe(page);
  const providerResult = JSON.parse(await page.locator("#probe-result").innerText());
  const evidence = providerResult?.response?.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error("Polymarket probe returned no bounded evidence");
  }
  if (!evidence.every((item) => item?.provider === "polymarket")) {
    throw new Error("Provider probe returned evidence from an unexpected provider");
  }
  if (evidence.length > 5) throw new Error("Provider probe exceeded the bounded evidence limit");
  if (JSON.stringify(providerResult).includes(sentinel)) {
    throw new Error("Sentinel credential appeared in provider response");
  }

  let modelStatus = "NOT RUN: no key";
  if (ambientModel) {
    await page.getByRole("button", { name: "Run model + route probe" }).click();
    await waitForProbe(page, 120_000);
    const modelResult = JSON.parse(await page.locator("#probe-result").innerText());
    if (!modelResult?.response?.route || !modelResult?.response?.diagnosticSynthesis) {
      throw new Error("Model probe did not return both route and diagnostic synthesis");
    }
    modelStatus = "PASS";
  }

  await page.reload({ waitUntil: "networkidle" });
  await expectText(page.locator("#probe-result"), '"provider": "polymarket"');
  await page.getByRole("button", { name: "Clear saved data" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await expectText(page.locator("#saved-indicator"), "No model key saved");
  await expectText(page.locator("#probe-result"), "No probe result yet.");

  const leakedErrors = capturedErrors.filter((message) => message.includes(sentinel));
  if (leakedErrors.length > 0) throw new Error("Sentinel credential appeared in browser errors");
  if (serverOutput.includes(sentinel)) {
    throw new Error("Sentinel credential appeared in server output");
  }

  process.stdout.write(
    [
      "BROWSER_SMOKE PASS",
      `chromium=${browser.version()}`,
      `webcontainerNode=${health.nodeVersion}`,
      `bootMs=${bootMs}`,
      `providerMs=${providerResult.durationMs}`,
      `evidenceCount=${evidence.length}`,
      `modelRouter=${modelStatus}`,
    ].join(" ") + "\n",
  );
} catch (error) {
  const message = redact(error instanceof Error ? error.message : String(error));
  const safeServerOutput = redact(serverOutput).slice(-1_000);
  process.stderr.write(`BROWSER_SMOKE FAIL: ${message}\n${safeServerOutput}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The exact temporary process group already exited.
    }
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Vite server exited before becoming ready");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Vite server");
}

async function expectText(locator, text, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await locator.innerText()).includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for visible state: ${text}`);
}

async function expectRuntimeReady(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await page.locator("#runtime-status").innerText();
    if (status.includes("Ready")) return;
    if (status.includes("Failed")) {
      throw new Error(`Runtime boot failed: ${redact(await page.locator("#health-result").innerText())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for visible state: Ready");
}

async function waitForProbe(page, timeout = 60_000) {
  const locator = page.locator("#probe-result");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await locator.innerText();
    if (text !== "Running probe…" && text.startsWith("{")) return;
    if (text !== "Running probe…" && !text.startsWith("{")) {
      throw new Error(`Probe failed: ${redact(text)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for probe result");
}

async function assertBridgeRejectsInvalidMessages(page) {
  const result = await page.evaluate(async () => {
    const frame = document.querySelector("#runtime-bridge");
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow || !frame.src) {
      throw new Error("Runtime bridge iframe is unavailable");
    }
    if (frame.hasAttribute("sandbox")) throw new Error("Runtime bridge must not use sandbox");
    if (frame.getAttribute("allow") !== "cross-origin-isolated") {
      throw new Error("Runtime bridge is missing its isolation permission");
    }
    const runtimeOrigin = new URL(frame.src).origin;
    const before = Number.parseInt(document.documentElement.dataset.bridgeRejected ?? "0", 10);
    const fakeResponse = {
      channel: "opencandle-browser-runtime-v1",
      type: "response",
      requestId: "f".repeat(32),
      ok: true,
      result: { forged: true },
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://wrong-origin.invalid",
        source: frame.contentWindow,
        data: fakeResponse,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: runtimeOrigin,
        source: window,
        data: fakeResponse,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: runtimeOrigin,
        source: frame.contentWindow,
        data: fakeResponse,
      }),
    );
    const after = Number.parseInt(document.documentElement.dataset.bridgeRejected ?? "0", 10);

    const unknownOperationReplied = await new Promise((resolve) => {
      const requestId = "e".repeat(32);
      const listener = (event) => {
        if (
          event.origin === runtimeOrigin &&
          event.source === frame.contentWindow &&
          event.data?.channel === "opencandle-browser-runtime-v1" &&
          event.data?.requestId === requestId
        ) {
          window.removeEventListener("message", listener);
          resolve(true);
        }
      };
      window.addEventListener("message", listener);
      frame.contentWindow.postMessage(
        {
          channel: "opencandle-browser-runtime-v1",
          operation: "unknown",
          requestId,
        },
        runtimeOrigin,
      );
      setTimeout(() => {
        window.removeEventListener("message", listener);
        resolve(false);
      }, 300);
    });
    return { rejectedDelta: after - before, unknownOperationReplied };
  });

  if (result.rejectedDelta !== 3) {
    throw new Error("Host did not reject wrong origin, wrong source, and unknown request id");
  }
  if (result.unknownOperationReplied) {
    throw new Error("Runtime bridge accepted an unknown operation");
  }
}

function selectAmbientModel(environment) {
  if (environment.GEMINI_API_KEY?.trim()) {
    return { provider: "google", key: environment.GEMINI_API_KEY };
  }
  if (environment.OPENAI_API_KEY?.trim()) {
    return { provider: "openai", key: environment.OPENAI_API_KEY };
  }
  if (environment.ANTHROPIC_API_KEY?.trim()) {
    return { provider: "anthropic", key: environment.ANTHROPIC_API_KEY };
  }
  return undefined;
}

function redact(value) {
  return selectAmbientModel(process.env)
    ? value
        .replaceAll(sentinel, "[redacted]")
        .replaceAll(selectAmbientModel(process.env).key, "[redacted]")
    : value.replaceAll(sentinel, "[redacted]");
}
