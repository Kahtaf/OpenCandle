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
  ? "Use get_stock_quote, get_stock_history, and get_options_chain for AAPL. Report its price, five-day direction, and one current option quote."
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
  await waitForText(page, "Market research, on your machine", 120_000);
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
    await waitForText(page, "Market research, on your machine", 30_000);
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
    await page.getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: /^OpenAI/ }).click();
    await page
      .getByRole("radio", { name: /Keep on this device/ })
      .evaluate((control) => control.click());
    await page.getByRole("textbox", { name: "OpenAI API key" }).fill(apiKey);
    await page
      .locator('[data-slot="provider-key-form"]')
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

    stage = "Pi model and reasoning controls";
    const modelTrigger = page.getByRole("button", {
      name: new RegExp(openAiModel.replaceAll(".", "\\.")),
    });
    await modelTrigger.click();
    assert(
      (await page.getByRole("menuitemradio").count()) > 1,
      "Pi exposes more than the default hosted model",
    );
    await waitForText(page, "Reasoning", 30_000);
    const lowReasoning = page.getByRole("button", { name: "low", exact: true });
    await lowReasoning.click();
    await waitFor(
      async () => (await lowReasoning.getAttribute("aria-pressed")) === "true",
      30_000,
      "Pi reasoning level selection",
    );
    const lowestReasoning = page.getByRole("button", { name: /^(?:off|minimal)$/i });
    await lowestReasoning.click();
    await waitFor(
      async () => (await lowestReasoning.getAttribute("aria-pressed")) === "true",
      30_000,
      "Pi reasoning level reset",
    );
    await modelTrigger.click();

    stage = "live Pi turn";
    const initialRows = await page.locator("[data-chat-row-id]").count();
    await page.getByRole("textbox", { name: "Message OpenCandle" }).fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await waitForCount(page.locator("[data-chat-row-id]"), initialRows + 2, 180_000);
    if (relayE2e) {
      await waitForText(page, "Stock quote", 180_000);
      await waitForText(page, "Price history", 180_000);
      await waitForText(page, "Options chain", 180_000);
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
      await page.getByRole("dialog").getByRole("button", { name: /^Google Gemini/ }).click();
      const googleKeyInput = page.getByRole("textbox", { name: "Google Gemini API key" });
      await googleKeyInput.fill(googleApiKey);
      await page
        .locator('[data-slot="provider-key-form"]')
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
    await waitForRuntimeReady(restored, 120_000);
    await waitForText(restored, prompt, 120_000);
    if (relayE2e) {
      await waitForText(restored, "Stock quote", 120_000);
      await waitForText(restored, "Price history", 120_000);
      await waitForText(restored, "Options chain", 120_000);
    } else {
      await waitForText(restored, "event probabilities", 120_000);
    }
    await page.close();
    page = restored;
    await waitForRuntimeReady(page, 120_000);
  }

  // The opt-in live relay smoke selects a real Yahoo candidate. Ordinary CI
  // exercises the bounded exact-symbol fallback so persistence, multi-tab,
  // offline, archive, update, and responsive coverage stay mandatory even
  // when no relay authorization is available.
  {
    stage = "watchlist state";
    // First run opens the onboarding dialog over the app, and it is modal. A
    // real user dismisses it before navigating, so do the same here. The
    // model-setup block above only runs when a key is available, so without
    // this the dialog is still open and intercepts the sidebar.
    if ((await page.locator('[role="dialog"][data-state="open"]').count()) > 0) {
      await page.keyboard.press("Escape");
      await waitFor(
        async () => (await page.locator('[role="dialog"][data-state="open"]').count()) === 0,
        30_000,
        "onboarding dialog dismiss",
      );
    }
    await page.getByRole("link", { name: "Watchlists" }).click();
    await waitForText(page, "Watchlists", 30_000);
    await page.getByRole("button", { name: "Add ticker" }).last().click();
    const symbolInput = page.getByRole("combobox", { name: "Search ticker or company" });
    await selectInstrumentCandidate(page, symbolInput, "AAPL");
    await page.getByRole("button", { name: "Save" }).click();
    await waitFor(
      async () => (await page.getByRole("button", { name: "Save", exact: true }).count()) === 0,
      120_000,
      "watchlist save acknowledgement",
    );
    await waitForText(page, "AAPL", 30_000);

    stage = "portfolio state";
    // Keep the route transition inside the running PWA: a full navigation
    // tears down the writer while the just-saved watchlist is persisting.
    // Chromium on Node 24 can transiently classify this sidebar link as
    // non-actionable even though it is present, so dispatch its normal click
    // without depending on that visibility heuristic.
    const portfoliosLink = page.locator('a[href="/portfolios"]').first();
    await Promise.all([
      page.waitForURL("**/portfolios", { timeout: 30_000 }),
      portfoliosLink.evaluate((link) => link.click()),
    ]);
    await waitForText(page, "Portfolios", 30_000);
    const addHoldingButton = page.getByRole("button", { name: "Add holding" }).last();
    await waitForEnabled(addHoldingButton, 30_000);
    await addHoldingButton.click();
    const holdingSymbolInput = page.getByRole("combobox", { name: "Search ticker or company" });
    await selectInstrumentCandidate(page, holdingSymbolInput, "MSFT");
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await page.getByRole("spinbutton", { name: "Average cost per share" }).fill("300");
    await page.getByRole("combobox", { name: "Currency" }).selectOption("USD");
    await page.getByRole("button", { name: "Save" }).click();
    await waitFor(
      async () => (await page.getByRole("button", { name: "Save", exact: true }).count()) === 0,
      120_000,
      "holding save acknowledgement",
    );
    await waitForTextExact(page, "MSFT", 30_000);
    await waitForStateCheckpoint(page, 30_000);
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

    stage = "runtime status chrome";
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 1440, height: 960 });
    await assertRuntimeStatusIsSilentWhenReady(page, "desktop watchlists at 1440");
    if (desktopViewport) await page.setViewportSize(desktopViewport);

    follower = await context.newPage();
    stage = "multi-tab follower";
    await follower.goto(`${origin}/watchlists`, { waitUntil: "domcontentloaded" });
    assert(
      await follower.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      "service worker control on a subsequent navigation",
    );
    await waitForRuntimeReady(follower, 120_000);
    await waitForText(follower, "AAPL", 120_000);
    const followerAddTicker = follower.getByRole("button", { name: "Add ticker" }).last();
    await waitForEnabled(followerAddTicker, 30_000);
    await followerAddTicker.click();
    const followerSymbolInput = follower.getByRole("combobox", {
      name: "Search ticker or company",
    });
    await selectInstrumentCandidate(follower, followerSymbolInput, "NVDA");
    await follower.getByRole("button", { name: "Save" }).click();
    await waitFor(
      async () => (await follower.getByRole("button", { name: "Save", exact: true }).count()) === 0,
      120_000,
      "follower watchlist mutation acknowledgement",
    );
    await waitForTextExact(follower, "NVDA", 30_000);
    await waitForTextExact(page, "NVDA", 30_000);
    await follower.getByRole("button", { name: "New chat", exact: true }).click();
    // What this stage is really about: New chat in a follower tab lands on the
    // fresh home surface. Assert that surface directly. It used to wait for the
    // onboarding dialog's copy whenever no model was connected, which only ever
    // worked because a new chat re-opened a dialog the user had already
    // dismissed at the watchlist stage. The home surface renders behind the
    // dialog either way, so this holds with or without a model key.
    await waitForText(follower, "What are we watching?", 30_000);

    const mobile = await context.newPage();
    stage = "mobile layout";
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${origin}/watchlists`, { waitUntil: "domcontentloaded" });
    await waitForRuntimeReady(mobile, 120_000);
    await waitForText(mobile, "AAPL", 120_000);
    await assertNoHorizontalOverflow(mobile, "mobile watchlist");
    await assertRuntimeStatusIsSilentWhenReady(mobile, "mobile watchlists at 390");

    const exportPath = join(tmpdir(), `opencandle-hosted-export-${Date.now()}.json`);
    stage = "data export";
    await openHostedDataSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: "Export", exact: true }).click(),
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
    await page
      .getByRole("button", { name: "Install update?", exact: true })
      .click();
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
    await openHostedDataSettings(page);
    const corruptChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await (await corruptChooser).setFiles({
      name: "corrupt-opencandle-archive.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":999}'),
    });
    await waitForText(page, "Unsupported hosted archive version", 30_000);
    await openWatchlists(page);
    await waitForText(page, "AAPL", 30_000);

    stage = "newer SQLite schema import";
    const newerSchemaArchive = await withStateSchemaVersion(exported, 999);
    await openHostedDataSettings(page);
    const newerSchemaChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await (await newerSchemaChooser).setFiles({
      name: "newer-opencandle-archive.json",
      mimeType: "application/json",
      buffer: Buffer.from(newerSchemaArchive),
    });
    await waitForText(page, "uses newer schema version 999", 30_000);
    await openWatchlists(page);
    await waitForText(page, "AAPL", 30_000);

    stage = "clear model key";
    await openHostedDataSettings(page);
    await page.getByRole("button", { name: "Clear secrets", exact: true }).click();
    await page.locator('[data-slot="alert-dialog-action"]').click();
    assert(await credentialsAreAbsent(page), "clear model key removes persistent and session keys");
    await page.reload({ waitUntil: "domcontentloaded" });
    await openWatchlists(page);
    await waitForText(page, "AAPL", 120_000);

    await context.setOffline(true);
    stage = "offline shell";
    const cachedShell = await follower.evaluate(async () => (await fetch("/index.html")).text());
    assert(cachedShell.includes('id="root"'), "offline cached application shell");
    await waitForText(page, "Offline: saved research is read-only", 30_000);
    await waitForText(page, "AAPL", 30_000);
    const mutationButtons = await page.getByRole("button", { name: "Add ticker" }).all();
    await waitFor(async () => {
      const visibleMutationStates = [];
      for (const button of mutationButtons) {
        if (await button.isVisible()) visibleMutationStates.push(await button.isDisabled());
      }
      return visibleMutationStates.length > 0 && visibleMutationStates.every(Boolean);
    }, 30_000, "offline mutations disabled");
    await openHostedDataSettings(page);
    assert(
      await page.getByRole("button", { name: "Export", exact: true }).isEnabled(),
      "offline export",
    );
    assert(
      await page.getByRole("button", { name: "Import", exact: true }).isDisabled(),
      "offline import disabled",
    );
    await context.setOffline(false);

    await follower.close();
    await mobile.close();
    stage = "clear and restore";
    await openHostedDataSettings(page);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    const typedConfirm = page.locator('[data-slot="typed-confirm-dialog"]');
    await typedConfirm.waitFor({ state: "visible", timeout: 30_000 });
    assert(
      await typedConfirm.locator('[data-slot="typed-confirm-action"]').isDisabled(),
      "clear all stays disabled until the confirmation word is typed",
    );
    await typedConfirm.locator("input").fill("DELETE");
    await Promise.all([
      page.waitForEvent("framenavigated", { timeout: 120_000 }),
      typedConfirm.locator('[data-slot="typed-confirm-action"]').click(),
    ]);
    await openWatchlists(page);
    await waitForText(page, "No tickers yet", 120_000);
    assert((await page.getByText("AAPL", { exact: true }).count()) === 0, "clear removes watchlist");
    assert(await credentialsAreAbsent(page), "clear removes persistent and session model keys");
    await openHostedDataSettings(page);
    const restoreChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const restoredNavigation = page.waitForEvent("framenavigated", { timeout: 120_000 });
    await (await restoreChooser).setFiles(exportPath);
    await restoredNavigation;
    await openWatchlists(page);
    await waitForText(page, "AAPL", 120_000);
    assert(await credentialsAreAbsent(page), "archive restore excludes the model key");
  }

  const secretErrors = apiKey ? browserErrors.filter((message) => message.includes(apiKey)) : [];
  if (googleApiKey) {
    secretErrors.push(...browserErrors.filter((message) => message.includes(googleApiKey)));
  }
  assert(secretErrors.length === 0, "model key absent from browser errors");
  assert(!apiKey || !serverOutput.includes(apiKey), "model key absent from static host logs");
  assert(!googleApiKey || !serverOutput.includes(googleApiKey), "Google key absent from static host logs");
  process.stdout.write(
    `HOSTED_PWA_SMOKE PASS chromium=${browser.version()} livePi=${completedLiveTurn ? "PASS" : "SKIP"} marketState=PASS multiTab=PASS offline=PASS archive=PASS mobile=PASS\n`,
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

async function waitForStateCheckpoint(page, timeoutMs) {
  await waitFor(async () => {
    try {
      const counts = await inspectStateArchive(await readStateCheckpoint(page));
      return counts.portfolioLots >= 1;
    } catch {
      // OPFS replaces the checkpoint atomically, so a read can land between
      // the old handle being removed and the new archive becoming visible.
      return false;
    }
  }, timeoutMs, "portfolio checkpoint persistence");
}

function sqliteCount(database, table) {
  const rows = database.exec(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0]?.values?.[0]?.[0] ?? 0);
}

// Data management lives in Settings now, reached from the sidebar like any
// other page. Hosted chrome carries no data link of its own.
async function openHostedDataSettings(page) {
  if (!page.url().includes("/settings/data")) {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Data & privacy", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Export", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function openWatchlists(page) {
  await page.getByRole("link", { name: "Watchlists" }).click();
}

// A ready hosted runtime is silent. There is no footer strip, no permanent
// status text, and nothing between the reader and the page's own action.
async function assertRuntimeStatusIsSilentWhenReady(page, label) {
  const action = page.getByRole("button", { name: "New Watchlist" }).last();
  await action.waitFor({ state: "visible", timeout: 30_000 });
  assert(
    (await page.locator(".hosted-runtime-panel").count()) === 0,
    `${label} carries no hosted footer strip`,
  );
  for (const text of ["Running on this device", "Ready through the active tab", "Manage data"]) {
    assert(
      (await page.getByText(text, { exact: false }).count()) === 0,
      `${label} carries no permanent "${text}" status`,
    );
  }
  const actionBox = await action.boundingBox();
  assert(actionBox, `${label} page action geometry`);
  const actionOwnsItsPoint = await page.evaluate(
    (point) => document.elementFromPoint(point.x, point.y)?.closest("button")?.textContent ?? "",
    { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height / 2 },
  );
  assert(
    actionOwnsItsPoint.includes("New Watchlist"),
    `${label} page action receives its own pointer events`,
  );
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(sizes.scrollWidth <= sizes.width + 1, `${label} horizontal overflow`);
}

// A ready hosted runtime says nothing, so readiness is proved by the app's own
// connection state rather than by a permanent status label.
async function waitForRuntimeReady(page, timeoutMs) {
  await waitFor(
    async () =>
      (await page.getByText("Connecting to the GUI session", { exact: false }).count()) === 0 &&
      (await page.getByText("Reconnecting to the GUI session", { exact: false }).count()) === 0 &&
      (await page.getByText("Starting browser runtime", { exact: false }).count()) === 0 &&
      (await page.getByText("Preparing browser runtime", { exact: false }).count()) === 0,
    timeoutMs,
    "hosted runtime ready",
  );
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

async function selectInstrumentCandidate(page, input, symbol) {
  await input.fill(symbol);
  if (!relayE2e) {
    await input.press("Enter");
    await waitForText(page, `Selected ${symbol}`, 30_000);
    return;
  }
  const candidate = page.getByRole("option", { name: new RegExp(`^${symbol} `) });
  await waitFor(
    async () => (await candidate.count()) === 1,
    30_000,
    `one ${symbol} instrument suggestion`,
  );
  await candidate.click();
  await waitForText(page, `Selected ${symbol}`, 30_000);
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
