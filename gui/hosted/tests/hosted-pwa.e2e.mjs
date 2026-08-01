import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import initSqlJs from "sql.js";

const port = process.env.OPENCANDLE_HOSTED_TEST_PORT
  ? Number.parseInt(process.env.OPENCANDLE_HOSTED_TEST_PORT, 10)
  : 30_000 + (process.pid % 20_000);
const origin = `http://127.0.0.1:${port}`;
const relayE2e = process.env.OPENCANDLE_PROVIDER_RELAY_E2E === "1";
const openAiModel = String(process.env.OPENCANDLE_HOSTED_E2E_OPENAI_MODEL || "gpt-5-mini");
const prompt = relayE2e
  ? "Use both get_stock_quote and get_stock_history for AAPL. Tell me its current price and whether it rose or fell over the last five trading days."
  : 'I am a conservative long-term investor. Use get_event_probabilities to search Polymarket for "SpaceX". Report one returned market and its probability in one sentence.';
const require = createRequire(import.meta.url);
const viteEntry = fileURLToPath(new URL("../../../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(
  process.execPath,
  [
    viteEntry,
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
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
let page;
let follower;
let stage = "launch";
const browserErrors = [];
const failedRequests = [];
try {
  await waitForServer(origin, 30_000);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.request().method()} ${response.url()} HTTP ${response.status()}`);
      void response
        .text()
        .then((body) => failedRequests.push(`BODY ${response.url()} ${body.slice(0, 1_000)}`))
        .catch(() => {});
    }
  });

  const response = await page.goto(origin, { waitUntil: "domcontentloaded" });
  stage = "first launch";
  assert(response?.headers()["cross-origin-embedder-policy"] === "require-corp", "COEP header");
  assert(response?.headers()["cross-origin-opener-policy"] === "same-origin", "COOP header");
  assert(
    response?.headers()["content-security-policy"]?.includes("default-src 'self'"),
    "credential-holding shell CSP",
  );
  assert(await page.evaluate(() => globalThis.crossOriginIsolated), "cross-origin isolation");
  await waitForText(page, "Connect an AI model", 120_000);
  // Let the first WebContainer boot settle before checking PWA registration.
  // A newly opened page below proves service-worker control without replacing
  // the tab that owns the active WebContainer runtime.
  await assertInstallable(page);
  await assertNoHorizontalOverflow(page, "desktop first launch");

  if (relayE2e) {
    stage = "provider relay negotiation";
    await page.getByRole("link", { name: "Diagnostics" }).click();
    await waitForText(page, "Audited provider relay", 30_000);
    await waitForText(page, "Policy v1", 30_000);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await waitForText(page, "Connect an AI model", 30_000);
  }

  stage = "direct browser provider proof";
  const polymarketProof = await page.evaluate(async () => {
    const response = await fetch(
      "https://gamma-api.polymarket.com/public-search?q=fed%20rate%20cut&limit=1",
      { credentials: "omit" },
    );
    const body = await response.json();
    return {
      ok: response.ok,
      bounded: JSON.stringify(body).length < 1_000_000,
      hasMarkets: Array.isArray(body?.events) || Array.isArray(body?.markets) || Array.isArray(body),
    };
  });
  assert(polymarketProof.ok, "Polymarket direct-browser response");
  assert(polymarketProof.bounded, "Polymarket bounded direct-browser response");
  assert(polymarketProof.hasMarkets, "Polymarket direct-browser market payload");

  const coinGeckoProof = await page.evaluate(async () => {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false",
      { credentials: "omit" },
    );
    const body = await response.json();
    return {
      ok: response.ok,
      bounded: JSON.stringify(body).length < 1_000_000,
      hasMarketData: body?.id === "bitcoin" && typeof body?.market_data === "object",
    };
  });
  assert(coinGeckoProof.ok, "CoinGecko direct-browser response");
  assert(coinGeckoProof.bounded, "CoinGecko bounded direct-browser response");
  assert(coinGeckoProof.hasMarketData, "CoinGecko direct-browser market payload");

  const alphaVantageKey = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();
  if (alphaVantageKey) {
    const alphaVantageProof = await page.evaluate(async (apiKey) => {
      const url = new URL("https://www.alphavantage.co/query");
      url.search = new URLSearchParams({
        function: "OVERVIEW",
        symbol: "AAPL",
        apikey: apiKey,
      }).toString();
      const response = await fetch(url, { credentials: "omit" });
      const body = await response.json();
      return {
        ok: response.ok,
        hasOverview: body?.Symbol === "AAPL" && typeof body?.Name === "string",
      };
    }, alphaVantageKey);
    assert(alphaVantageProof.ok, "Alpha Vantage direct-browser response");
    assert(alphaVantageProof.hasOverview, "Alpha Vantage direct-browser company payload");
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const googleApiKey = String(process.env.GEMINI_API_KEY || "").trim();
  let completedLiveTurn = false;
  if (apiKey) {
    stage = "model setup";
    await page
      .getByRole("radio", { name: /Keep on this device/ })
      .evaluate((control) => control.click());
    await page.getByRole("textbox", { name: "OpenAI API key" }).fill(apiKey);
    await page
      .getByRole("textbox", { name: "OpenAI API key" })
      .locator("xpath=ancestor::div[contains(@class, 'content-start')]")
      .getByRole("button", { name: "Save key" })
      .click();
    await waitFor(
      async () =>
        (await page.getByRole("textbox", { name: "OpenAI API key" }).count()) === 0 ||
        browserErrors.some((message) => message.includes("Hosted runtime boot failed")),
      120_000,
      "credential field to clear after save",
    );
    const bootFailure = browserErrors.findLast((message) =>
      message.includes("Hosted runtime boot failed"),
    );
    if (bootFailure) throw new Error(bootFailure);
    await waitForEnabled(page.getByRole("textbox", { name: "Message OpenCandle" }), 120_000);
    if (openAiModel !== "gpt-5-mini") {
      await page.getByRole("button", { name: /gpt-5-mini/ }).click();
      await page
        .getByRole("menuitemradio", { name: new RegExp(openAiModel.replaceAll(".", "\\.")) })
        .click();
      await waitFor(
        async () => (await page.getByRole("button", { name: new RegExp(openAiModel.replaceAll(".", "\\.")) }).count()) > 0,
        120_000,
        `OpenAI Pi model selection: ${openAiModel}`,
      );
    }

    const initialRows = await page.locator("[data-chat-row-id]").count();
    await page.getByRole("textbox", { name: "Message OpenCandle" }).fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await waitForCount(page.locator("[data-chat-row-id]"), initialRows + 2, 180_000);
    if (relayE2e) {
      await waitForText(page, "Stock quote", 180_000);
      await waitForText(page, "Price history", 180_000);
      await waitFor(
        async () => (await page.locator("[data-chat-row-id]").last().innerText()).includes("AAPL"),
        180_000,
        "an AAPL quote-and-history assistant answer",
      );
    } else {
      await waitForText(page, "event probabilities", 180_000);
      await waitFor(
        async () => (await page.locator("[data-chat-row-id]").last().innerText()).includes("%"),
        180_000,
        "a probability-backed assistant answer",
      );
    }
    await page.waitForURL(/\/sessions\//, { timeout: 30_000 });
    completedLiveTurn = true;

    if (googleApiKey) {
      stage = "Pi model provider switch";
      await page.getByRole("button", { name: new RegExp(openAiModel.replaceAll(".", "\\.")) }).click();
      await page.getByRole("menuitem", { name: /Manage model keys/ }).click();
      const googleKeyInput = page.getByRole("textbox", { name: "Google Gemini API key" });
      await googleKeyInput.fill(googleApiKey);
      await googleKeyInput
        .locator("xpath=ancestor::div[contains(@class, 'content-start')]")
        .getByRole("button", { name: "Save key" })
        .click();
      await waitFor(
        async () => (await page.getByText("gemini-2.5-flash", { exact: true }).count()) > 0,
        120_000,
        "Google Pi model selection",
      );
      if ((await page.locator('[role="dialog"][data-state="open"]').count()) > 0) {
        await page.getByRole("button", { name: "Close dialog" }).click();
        await waitFor(
          async () => (await page.locator('[role="dialog"][data-state="open"]').count()) === 0,
          30_000,
          "model key dialog close",
        );
      }
      const expandedModelTrigger = page
        .locator('button[aria-expanded="true"]')
        .filter({ hasText: "gemini-2.5-flash" });
      if ((await expandedModelTrigger.count()) > 0) {
        await expandedModelTrigger.click({ force: true });
      }
      await page.getByRole("textbox", { name: "Message OpenCandle" }).waitFor({
        state: "visible",
        timeout: 30_000,
      });
      const rowsBeforeGoogle = await page.locator("[data-chat-row-id]").count();
      await page
        .getByRole("textbox", { name: "Message OpenCandle" })
        .fill("In one sentence, explain what a stock ticker is. Do not use tools.");
      await page.getByRole("button", { name: "Send message" }).click();
      await waitForCount(page.locator("[data-chat-row-id]"), rowsBeforeGoogle + 2, 180_000);
    }

    stage = "session reload";
    const restored = await context.newPage();
    await restored.goto(page.url(), { waitUntil: "domcontentloaded" });
    await waitForText(restored, "Connected to the active tab", 120_000);
    await waitForText(restored, prompt, 120_000);
    if (relayE2e) {
      await waitForText(restored, "Stock quote", 120_000);
      await waitForText(restored, "Price history", 120_000);
    } else {
      await waitForText(restored, "event probabilities", 120_000);
    }
    await page.close();
    page = restored;
    await waitForText(page, "Running on this device", 120_000);
  }

  stage = "watchlist state";
  await page.getByRole("link", { name: "Watchlists" }).click();
  await waitForText(page, "Watchlists", 30_000);
  await page.getByRole("button", { name: "Add ticker" }).last().click();
  const symbolInput = page.getByRole("combobox", { name: "Search ticker or company" });
  await symbolInput.fill("AAPL");
  await symbolInput.press("Enter");
  await waitForText(page, "Selected AAPL", 30_000);
  await page.getByRole("button", { name: "Save" }).click();
  await waitForText(page, "AAPL", 30_000);

  stage = "portfolio state";
  await page.getByRole("link", { name: "Portfolios" }).click();
  await waitForText(page, "Portfolios", 30_000);
  await page.getByRole("button", { name: "Add holding" }).last().click();
  const holdingSymbolInput = page.getByRole("combobox", { name: "Search ticker or company" });
  await holdingSymbolInput.fill("MSFT");
  await holdingSymbolInput.press("Enter");
  await waitForText(page, "Selected MSFT", 30_000);
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByRole("spinbutton", { name: "Average cost per share" }).fill("300");
  await page.getByRole("combobox", { name: "Currency" }).selectOption("USD");
  await page.getByRole("button", { name: "Save" }).click();
  await waitFor(
    async () => (await page.getByRole("button", { name: "Save", exact: true }).count()) === 0,
    30_000,
    "holding save acknowledgement",
  );
  await waitForTextExact(page, "MSFT", 30_000);
  const preReloadCounts = await inspectStateArchive(await readStateCheckpoint(page));
  assert(preReloadCounts.portfolioLots >= 1, "portfolio checkpoint persisted before reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForText(page, "MSFT", 120_000);

  if (completedLiveTurn) {
    stage = "saved-state attachment";
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await waitForEnabled(page.getByRole("textbox", { name: "Message OpenCandle" }), 120_000);
    await page.getByRole("button", { name: "Attach context" }).click();
    await page.getByRole("menuitem", { name: "Default", exact: true }).first().click();
    await waitForText(page, "Portfolio: Default", 30_000);
    const rowsBeforeAttachment = await page.locator("[data-chat-row-id]").count();
    await page
      .getByRole("textbox", { name: "Message OpenCandle" })
      .fill("Name the ticker in the attached portfolio. Answer with the ticker only. Do not use tools.");
    await page.getByRole("button", { name: "Send message" }).click();
    await waitForCount(page.locator("[data-chat-row-id]"), rowsBeforeAttachment + 2, 180_000);
    await waitFor(
      async () => (await page.locator("[data-chat-row-id]").last().innerText()).includes("MSFT"),
      180_000,
      "an answer grounded in the attached portfolio",
    );
  }

  stage = "watchlist reload";
  await page.getByRole("link", { name: "Watchlists" }).click();
  await waitForText(page, "AAPL", 30_000);

  follower = await context.newPage();
  stage = "multi-tab follower";
  await follower.goto(`${origin}/watchlists`, { waitUntil: "domcontentloaded" });
  assert(
    await follower.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    "service worker control on a subsequent navigation",
  );
  await waitForText(follower, "Connected to the active tab", 120_000);
  await waitForText(follower, "AAPL", 30_000);
  await follower.getByRole("button", { name: "New chat", exact: true }).click();
  await waitForText(
    follower,
    completedLiveTurn ? "What are we watching?" : "Connect an AI model",
    30_000,
  );

  const mobile = await context.newPage();
  stage = "mobile layout";
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${origin}/watchlists`, { waitUntil: "domcontentloaded" });
  await waitForText(mobile, "Connected to the active tab", 120_000);
  await waitForText(mobile, "AAPL", 30_000);
  await assertNoHorizontalOverflow(mobile, "mobile watchlist");

  const exportPath = join(tmpdir(), `opencandle-hosted-export-${Date.now()}.json`);
  stage = "data export";
  await openHostedPanel(page);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Export data" }).click(),
  ]);
  await download.saveAs(exportPath);
  const exported = await readFile(exportPath, "utf8");
  assert(!apiKey || !exported.includes(apiKey), "archive excludes OpenAI model key");
  assert(!googleApiKey || !exported.includes(googleApiKey), "archive excludes Google model key");
  const archive = JSON.parse(exported);
  assert(archive.version === 1, "archive version");
  assert(archive.sessions.length >= 1, "archive includes canonical Pi session");
  assert(Boolean(archive.stateBase64), "archive includes SQLite state");
  const stateCounts = await inspectStateArchive(archive.stateBase64);
  assert(stateCounts.watchlistItems >= 1, "SQLite archive includes the watchlist item");
  assert(stateCounts.portfolioLots >= 1, "SQLite archive includes the portfolio lot");
  if (completedLiveTurn) {
    assert(stateCounts.preferences >= 1, "SQLite archive includes extracted user memory");
    assert(stateCounts.workflowRuns >= 1, "SQLite archive includes workflow history");
  }

  stage = "update handoff";
  await page.evaluate(() => {
    globalThis.__opencandleUpdateMessages = [];
    dispatchEvent(
      new CustomEvent("opencandle:update-ready", {
        detail: {
          registration: {
            waiting: {
              postMessage(message) {
                globalThis.__opencandleUpdateMessages.push(message);
              },
            },
          },
        },
      }),
    );
  });
  await openHostedPanel(page);
  await page.getByRole("button", { name: "Install update" }).click();
  await waitFor(
    () =>
      page.evaluate(
        () =>
          globalThis.__opencandleUpdateMessages?.some(
            (message) => message?.type === "ACTIVATE_UPDATE",
          ) ?? false,
      ),
    120_000,
    "durable update handoff",
  );

  stage = "corrupt import";
  await openHostedPanel(page);
  const corruptChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import data" }).click();
  await (await corruptChooser).setFiles({
    name: "corrupt-opencandle-archive.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await waitForText(page, "Unsupported hosted archive version", 30_000);
  await waitForText(page, "AAPL", 30_000);

  stage = "newer SQLite schema import";
  const newerSchemaArchive = await withStateSchemaVersion(exported, 999);
  await openHostedPanel(page);
  const newerSchemaChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import data" }).click();
  await (await newerSchemaChooser).setFiles({
    name: "newer-opencandle-archive.json",
    mimeType: "application/json",
    buffer: Buffer.from(newerSchemaArchive),
  });
  await waitForText(page, "uses newer schema version 999", 30_000);
  await waitForText(page, "AAPL", 30_000);

  stage = "clear model key";
  await openHostedPanel(page);
  await page.getByRole("button", { name: "Clear secrets" }).click();
  assert(await credentialsAreAbsent(page), "clear model key removes persistent and session keys");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForText(page, "AAPL", 120_000);

  await context.setOffline(true);
  stage = "offline shell";
  const cachedShell = await follower.evaluate(async () => (await fetch("/index.html")).text());
  assert(cachedShell.includes('id="root"'), "offline cached application shell");
  await waitForText(page, "Offline: saved research is read-only", 30_000);
  await waitForText(page, "Saved-state changes are unavailable", 30_000);
  await waitForText(page, "AAPL", 30_000);
  await openHostedPanel(page);
  assert(await page.getByRole("button", { name: "Export data" }).isEnabled(), "offline export");
  const mutationButtons = await page.getByRole("button", { name: "Add ticker" }).all();
  const visibleMutationStates = [];
  for (const button of mutationButtons) {
    if (await button.isVisible()) visibleMutationStates.push(await button.isDisabled());
  }
  assert(
    visibleMutationStates.length > 0 && visibleMutationStates.every(Boolean),
    "offline mutations disabled",
  );
  await context.setOffline(false);

  await follower.close();
  await mobile.close();
  stage = "clear and restore";
  await openHostedPanel(page);
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForEvent("framenavigated", { timeout: 120_000 }),
    page.getByRole("button", { name: "Clear all" }).click(),
  ]);
  await waitForText(page, "No tickers yet", 120_000);
  assert((await page.getByText("AAPL", { exact: true }).count()) === 0, "clear removes watchlist");
  assert(await credentialsAreAbsent(page), "clear removes persistent and session model keys");
  await openHostedPanel(page);
  const restoreChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import data" }).click();
  const restoredNavigation = page.waitForEvent("framenavigated", { timeout: 120_000 });
  await (await restoreChooser).setFiles(exportPath);
  await restoredNavigation;
  await waitForText(page, "AAPL", 120_000);
  assert(await credentialsAreAbsent(page), "archive restore excludes the model key");

  const secretErrors = apiKey ? browserErrors.filter((message) => message.includes(apiKey)) : [];
  if (googleApiKey) {
    secretErrors.push(...browserErrors.filter((message) => message.includes(googleApiKey)));
  }
  assert(secretErrors.length === 0, "model key absent from browser errors");
  assert(!apiKey || !serverOutput.includes(apiKey), "model key absent from static host logs");
  assert(!googleApiKey || !serverOutput.includes(googleApiKey), "Google key absent from static host logs");
  process.stdout.write(
    `HOSTED_PWA_SMOKE PASS chromium=${browser.version()} livePi=${completedLiveTurn ? "PASS" : "SKIP"} multiTab=PASS offline=PASS archive=PASS mobile=PASS\n`,
  );
} catch (error) {
  const pageText = await page?.locator("body").innerText().catch(() => "");
  const followerText = await follower?.locator("body").innerText().catch(() => "");
  process.stderr.write(
    redact(
      `HOSTED_PWA_SMOKE FAIL stage=${stage}: ${error instanceof Error ? error.message : String(error)}\nPAGE=${String(pageText).slice(0, 2_000)}\nFOLLOWER=${String(followerText).slice(0, 2_000)}\nBROWSER=${browserErrors.join("\n").slice(-2_000)}\nBROWSER_MODEL=${browserErrors.filter((message) => /validate_model_key|configure_model|runtime (?:boot|stopped)/i.test(message)).join("\n").slice(-2_000)}\nREQUESTS=${failedRequests.join("\n").slice(-4_000)}\n${serverOutput.slice(-1_000)}\n`,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The temporary preview process already exited.
    }
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (server.exitCode === null) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // The temporary preview process exited during the grace period.
      }
    }
  }
}

async function assertInstallable(page) {
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert(manifestHref, "manifest link");
  const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
  assert(manifest.display === "standalone", "standalone manifest");
  assert(manifest.icons.some((icon) => icon.sizes === "192x192"), "192px icon");
  assert(manifest.icons.some((icon) => icon.sizes === "512x512"), "512px icon");
  await page.evaluate(() => navigator.serviceWorker.ready);
}

async function credentialsAreAbsent(page) {
  return page.evaluate(() => {
    const key = "opencandle.hosted.credentials.v1";
    return localStorage.getItem(key) === null && sessionStorage.getItem(key) === null;
  });
}

async function inspectStateArchive(stateBase64) {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const database = new SQL.Database(Buffer.from(stateBase64, "base64"));
  try {
    return {
      watchlistItems: sqliteCount(database, "watchlist_items"),
      portfolioLots: sqliteCount(database, "portfolio_lots"),
      preferences: sqliteCount(database, "user_preferences"),
      workflowRuns: sqliteCount(database, "workflow_runs"),
    };
  } finally {
    database.close();
  }
}

async function withStateSchemaVersion(serialized, version) {
  const archive = JSON.parse(serialized);
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const database = new SQL.Database(Buffer.from(archive.stateBase64, "base64"));
  try {
    database.run("UPDATE schema_version SET version = ?", [version]);
    archive.stateBase64 = Buffer.from(database.export()).toString("base64");
    return JSON.stringify(archive);
  } finally {
    database.close();
  }
}

async function readStateCheckpoint(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("opencandle-hosted-v1", { create: false });
    const checkpoint = await directory.getFileHandle("checkpoint-v1.json", { create: false });
    const archive = JSON.parse(await (await checkpoint.getFile()).text());
    return archive.stateBase64;
  });
}

function sqliteCount(database, table) {
  const rows = database.exec(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0]?.values?.[0]?.[0] ?? 0);
}

async function openHostedPanel(page) {
  const details = page.locator(".hosted-runtime-panel details");
  if (!(await details.evaluate((element) => element.open))) {
    await page.locator(".hosted-runtime-panel summary").click();
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(sizes.scrollWidth <= sizes.width + 1, `${label} horizontal overflow`);
}

async function waitForText(page, text, timeoutMs) {
  await waitFor(
    async () => (await page.getByText(text, { exact: false }).count()) > 0,
    timeoutMs,
    `visible text: ${text}`,
  );
}

async function waitForTextExact(page, text, timeoutMs) {
  await waitFor(
    async () => (await page.getByText(text, { exact: true }).count()) > 0,
    timeoutMs,
    `exact visible text: ${text}`,
  );
}

async function waitForEnabled(locator, timeoutMs) {
  await waitFor(async () => locator.isEnabled().catch(() => false), timeoutMs, "enabled control");
}

async function waitForCount(locator, minimum, timeoutMs) {
  await waitFor(async () => (await locator.count()) >= minimum, timeoutMs, `at least ${minimum} rows`);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForServer(url, timeoutMs) {
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error("Hosted preview exited before becoming ready");
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }, timeoutMs, "hosted preview");
}

function assert(condition, label) {
  if (!condition) throw new Error(`Missing or invalid ${label}`);
}

function redact(value) {
  const secrets = [
    process.env.OPENAI_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.ALPHA_VANTAGE_API_KEY,
    process.env.FRED_API_KEY,
    process.env.FINNHUB_API_KEY,
    process.env.BRAVE_API_KEY,
    process.env.EXA_API_KEY,
    process.env.LSE_API_KEY,
  ]
    .map((secret) => String(secret || "").trim())
    .filter(Boolean);
  return secrets.reduce(
    (redacted, secret) => redacted.split(secret).join("[redacted]"),
    String(value),
  );
}
