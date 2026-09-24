import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { startBrowserCoverage, stopBrowserCoverage } from "../../helpers/browser-coverage.js";
import {
  type DeterministicModelServer,
  type ModelChatRequest,
  type ModelScript,
  startDeterministicModelServer,
} from "../../helpers/deterministic-model-server.js";
import { createBrowserRequestGuard, launchJourneyBrowser } from "./browser.js";
import {
  type GuiJourneyFixtureServer,
  type StartFixtureServerOptions,
  startGuiJourneyFixtureServer,
} from "./fixture-server.js";
import { allocatePort, type GuiServerProcess, startGuiServer } from "./gui-process.js";
import { blankedCredentialEnv, GUI_JOURNEY_API_KEY, writeModelRuntimeConfig } from "./pi-config.js";

/**
 * Composes one isolated full-stack GUI journey:
 *
 *   Playwright browser  ->  real gui/server/server.ts child process
 *                       ->  local HTTP model fixture (scripted SSE)
 *                       ->  local fixture server for external data/tool/font HTTP
 *
 * No GUI HTTP/SSE/WebSocket/controller/storage code is faked. The child uses an
 * isolated HOME, OPENCANDLE_HOME, PI_CODING_AGENT_DIR, and blanked credentials.
 */

export interface GuiJourneyHarness {
  readonly root: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly baseUrl: string;
  readonly browser: Browser;
  readonly page: Page;
  readonly modelServer: DeterministicModelServer;
  readonly aux: GuiJourneyFixtureServer;
  readonly browserGuard: ReturnType<typeof createBrowserRequestGuard>;
  readonly guiLog: () => string;
  readonly unexpectedServerRequests: () => string[];
  /** Absolute path of the persisted Pi session file whose name contains sessionId. */
  findSessionFile(sessionId: string): string | undefined;
  /** Parsed JSONL entries of the persisted session, one object per line. */
  readSessionEntries(sessionId: string): unknown[];
  /** Resolves once the harness is stopped; safe to call once. */
  stop(): Promise<void>;
}

export interface StartHarnessOptions {
  modelScript: ModelScript;
  /** Optional bounded external-HTTP fixture holds (e.g. held tool fetch). */
  fixture?: StartFixtureServerOptions;
}

export async function startGuiJourneyHarness(
  options: StartHarnessOptions,
): Promise<GuiJourneyHarness> {
  const root = mkdtempSync(join(tmpdir(), "oc-gui-journey-"));
  const agentDir = join(root, "agent");
  const home = join(root, "home");
  const openCandleHome = join(root, "opencandle");
  const sessionDir = join(root, "sessions");
  const unexpectedLog = join(root, "unexpected-server-requests.log");
  mkdirSync(home, { recursive: true });
  mkdirSync(openCandleHome, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  let modelServer: DeterministicModelServer | undefined;
  let aux: GuiJourneyFixtureServer | undefined;
  let gui: GuiServerProcess | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let coverageStarted = false;

  try {
    modelServer = await startDeterministicModelServer(options.modelScript);
    aux = await startGuiJourneyFixtureServer(options.fixture);
    writeModelRuntimeConfig({ agentDir, modelBaseUrl: modelServer.baseUrl });

    const port = await allocatePort();
    gui = await startGuiServer({
      cwd: process.cwd(),
      bootstrapPath: join(process.cwd(), "tests/support/gui-journey/gui-server-bootstrap.ts"),
      port,
      env: {
        ...process.env,
        ...blankedCredentialEnv(),
        HOME: home,
        OPENCANDLE_HOME: openCandleHome,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        OPENCANDLE_GUI_HOST: "127.0.0.1",
        OPENCANDLE_GUI_PORT: String(port),
        OPENCANDLE_AUTOMATION_HEARTBEAT_MS: "3600000",
        OC_GUI_JOURNEY_MODEL_BASE_URL: modelServer.baseUrl,
        OC_GUI_JOURNEY_AUX_BASE_URL: aux.baseUrl,
        OC_GUI_JOURNEY_UNEXPECTED_LOG: unexpectedLog,
      },
    });

    browser = await launchJourneyBrowser();
    const browserGuard = createBrowserRequestGuard(gui.baseUrl);
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await browserGuard.install(page);
    // Opt-in raw browser coverage starts before any navigation and stops before
    // the page/browser closes, including when a test fails.
    await startBrowserCoverage(page);
    coverageStarted = true;

    const activeModel = modelServer;
    const activeAux = aux;
    const activeGui = gui;
    const activeBrowser = browser;
    const activePage = page;
    const activeGuard = browserGuard;

    let stopped = false;
    return {
      root,
      agentDir,
      sessionDir,
      baseUrl: activeGui.baseUrl,
      browser: activeBrowser,
      page: activePage,
      modelServer: activeModel,
      aux: activeAux,
      browserGuard: activeGuard,
      guiLog: () => activeGui.readLog(),
      unexpectedServerRequests: () => readUnexpected(unexpectedLog),
      findSessionFile(sessionId: string) {
        return findSessionFile(join(agentDir, "sessions"), sessionId);
      },
      readSessionEntries(sessionId: string) {
        const file = findSessionFile(join(agentDir, "sessions"), sessionId);
        if (!file) return [];
        return readFileSync(file, "utf-8")
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as unknown);
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        const failures: Error[] = [];
        // Capture browser coverage before the page/browser closes. The helper
        // is a no-op unless OPENCANDLE_BROWSER_COVERAGE=1, so normal journeys
        // pay nothing. Every step is attempted even if an earlier one fails.
        await attempt(() => stopBrowserCoverage(activePage, "gui-session-journey"), failures);
        await attempt(() => activeBrowser.close(), failures);
        await attempt(() => activeGui.stop(), failures);
        await attempt(() => activeAux.stop(), failures);
        await attempt(() => activeModel.stop(), failures);
        await attempt(() => rmSync(root, { recursive: true, force: true }), failures);
        if (failures.length > 0) {
          throw new Error(
            `GUI journey harness stop failed: ${failures.map((error) => error.message).join("; ")}`,
            { cause: failures[0] },
          );
        }
      },
    };
  } catch (error) {
    // Setup failed partway through: best-effort close whatever was already
    // created (coverage, browser, GUI child, fixtures) and remove the temp dir,
    // then rethrow the original startup error.
    const failures: Error[] = [];
    if (coverageStarted && page) {
      await attempt(() => stopBrowserCoverage(page as Page, "gui-session-journey"), failures);
    }
    if (browser) await attempt(() => (browser as Browser).close(), failures);
    if (gui) await attempt(() => (gui as GuiServerProcess).stop(), failures);
    if (aux) await attempt(() => (aux as GuiJourneyFixtureServer).stop(), failures);
    if (modelServer) {
      await attempt(() => (modelServer as DeterministicModelServer).stop(), failures);
    }
    await attempt(() => rmSync(root, { recursive: true, force: true }), failures);
    if (failures.length > 0) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}; startup cleanup failed: ${failures.map((failure) => failure.message).join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function attempt(step: () => void | Promise<void>, failures: Error[]): Promise<void> {
  try {
    await step();
  } catch (error) {
    failures.push(error instanceof Error ? error : new Error(String(error)));
  }
}

function readUnexpected(path: string): string[] {
  try {
    return readFileSync(path, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function findSessionFile(dir: string, sessionId: string): string | undefined {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findSessionFile(full, sessionId);
      if (nested) return nested;
    } else if (entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
      return full;
    }
  }
  return undefined;
}

export function modelRequestContains(request: ModelChatRequest, needle: string): boolean {
  return JSON.stringify(request.messages).includes(needle);
}

export { GUI_JOURNEY_API_KEY };
