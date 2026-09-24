import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { expect } from "vitest";

export function resolveChromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(macChrome)) return macChrome;
  return bundled;
}

export async function submitPrompt(page: Page, prompt: string): Promise<void> {
  await waitForRunIdle(page);
  await page.getByLabel("Message OpenCandle").fill(prompt);
  const sendButton = page.getByRole("button", { name: "Send" });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[aria-label="Send message"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    null,
    { timeout: 45_000 },
  );
  await sendButton.click();
}

export async function startNewChat(page: Page): Promise<void> {
  await waitForRunIdle(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expectVisible(page.getByRole("heading", { name: "What are we watching?" }));
}

export async function expectVisible(locator: Locator, timeout = 5_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

export function isPointerTarget(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('[role="option"]') === element
  );
}

export async function waitForRunIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector("[data-run-state]");
      return panel?.getAttribute("data-run-state") === "ready";
    },
    null,
    { timeout: 90_000 },
  );
}

export function hasScrollableAncestor(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return true;
    current = current.parentElement;
  }
  return false;
}

export async function runGuiChat(
  page: Page,
  sessionId: string,
  prompt: string,
): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    async ({ targetSessionId, targetPrompt }) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: targetPrompt,
          sessionId: targetSessionId,
          actionId: `gui-tui-parity-${Date.now()}`,
        }),
      });
      if (!response.ok) {
        throw new Error(`chat run failed: ${response.status} ${await response.text()}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("chat run response did not include an SSE body");
      const decoder = new TextDecoder();
      const events: Record<string, unknown>[] = [];
      let buffer = "";
      const parseEventChunk = (chunk: string) => {
        const line = chunk.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (line) events.push(JSON.parse(line.slice("data: ".length)));
      };
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            parseEventChunk(chunk);
          }
        }
        if (done) break;
      }
      if (buffer.trim()) parseEventChunk(buffer);
      return events;
    },
    { targetSessionId: sessionId, targetPrompt: prompt },
  );
}

export async function fetchGuiSessionSnapshot(page: Page, sessionId?: string): Promise<unknown> {
  return page.evaluate(async (targetSessionId) => {
    // Session-addressed bootstrap: the plain /api/bootstrap returns the
    // server's focused session, not the session the run was dispatched to.
    const path = targetSessionId
      ? `/api/sessions/${encodeURIComponent(targetSessionId)}/bootstrap`
      : "/api/bootstrap";
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`session bootstrap failed: ${response.status} ${await response.text()}`);
    }
    const bootstrap = await response.json();
    return bootstrap.snapshot;
  }, sessionId);
}

export function opencandleEntrySequence(entries: unknown[]): string[] {
  return entries.map((entry) => String(recordValue(entry).customType));
}

export function isOpenCandleCustomEntry(entry: unknown): boolean {
  const record = recordValue(entry);
  return record.type === "custom" && stringValue(record.customType)?.startsWith("opencandle-");
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function writeParityEvidence(fileName: string, content: unknown): void {
  const evidenceDir = process.env.OPENCANDLE_GUI_TUI_PARITY_EVIDENCE_DIR;
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, fileName);
  if (content instanceof Uint8Array) {
    writeFileSync(path, content);
    return;
  }
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

/**
 * Deterministic browser lanes must never reach the public internet. The real
 * GUI server on localhost is the only permitted origin. Product assets that the
 * shipped bundle normally pulls from a known CDN are served from a local stub;
 * every other external request is aborted and recorded so the lane fails
 * instead of silently depending on an external service or leaking user data.
 */
const EXTERNAL_ASSET_STUBS: Record<string, { contentType: string; body: string }> = {
  // gui/web/index.html links Inter and JetBrains Mono from Google Fonts.
  "https://fonts.googleapis.com": { contentType: "text/css; charset=utf-8", body: "" },
  "https://fonts.gstatic.com": { contentType: "font/woff2", body: "" },
  // gui/web/src/components/ui/favicon.jsx resolves site icons through Google.
  "https://www.google.com": {
    contentType: "image/gif",
    body: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  },
};

export function createExternalTrafficGuard(baseUrl: string) {
  const allowedOrigin = new URL(baseUrl).origin;
  const unexpected: string[] = [];
  return {
    unexpected,
    async guard(page: Page): Promise<void> {
      await page.route("**/*", (route) => {
        const requestUrl = route.request().url();
        if (!requestUrl.startsWith("http://") && !requestUrl.startsWith("https://")) {
          return route.continue();
        }
        let origin = "";
        try {
          origin = new URL(requestUrl).origin;
        } catch {
          origin = "";
        }
        if (origin === allowedOrigin) return route.continue();
        const stub = EXTERNAL_ASSET_STUBS[origin];
        if (stub) {
          return route.fulfill({
            status: 200,
            contentType: stub.contentType,
            body: Buffer.from(stub.body, "base64"),
          });
        }
        unexpected.push(requestUrl);
        return route.abort("blockedbyclient");
      });
    },
    assertClean(): void {
      if (unexpected.length > 0) {
        throw new Error(`Unexpected external browser traffic: ${unexpected.join(", ")}`);
      }
    },
  };
}
