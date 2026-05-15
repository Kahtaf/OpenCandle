#!/usr/bin/env tsx
/**
 * One-off verification: runs TWO prompts sequentially through the same
 * AgentSession to prove priorTurns is actually extracted from the real
 * session branch on turn 2. manual-run.ts only does one prompt per
 * invocation, so this is the only live-harness path that exercises
 * `buildPriorTurns` against a non-empty branch.
 *
 * Usage: OPENCANDLE_ROUTER_MODE=llm npx tsx tests/scripts/verify-multi-turn.ts
 *
 * NOT wired into npm test. Delete after verification or keep as a scratch
 * runner — does not represent a committed integration test.
 */
import type { AgentSessionEvent, SessionEntry } from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import type { AskUserHandler } from "../../src/types/index.js";

const openCandleHome = mkdtempSync(join(tmpdir(), "oc-multiturn-"));
process.env.OPENCANDLE_HOME = openCandleHome;

const askUserHandler: AskUserHandler = async () => ({ answer: "balanced", cancelled: false });

const { session } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: "google",
    defaultModel: "gemini-2.5-flash",
  }),
  useInlineExtension: true,
  askUserHandler,
});

cache.clear();

async function runPrompt(prompt: string, label: string): Promise<void> {
  console.log(`\n=== ${label}: "${prompt}" ===`);

  await new Promise<void>((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settleTimer) clearTimeout(settleTimer);
      unsub();
      resolve();
    };

    const resetSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, 5000);
    };

    const unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update") {
        if (settleTimer) clearTimeout(settleTimer);
      }
      if (event.type === "agent_end") resetSettle();
    });

    void session.prompt(prompt);
  });

  console.log(`  [${label}] agent settled`);
}

await runPrompt("tell me about NVDA", "TURN 1");
await runPrompt("what about at $500?", "TURN 2");

const entries = session.sessionManager.getEntries();
const customEntries = entries
  .filter(
    (e: SessionEntry): e is Extract<SessionEntry, { type: "custom" }> =>
      e.type === "custom" &&
      typeof (e as { customType?: string }).customType === "string" &&
      (e as { customType: string }).customType.startsWith("opencandle-"),
  )
  .map((e) => ({ customType: e.customType, data: e.data, timestamp: e.timestamp }));

console.log("\n=== CUSTOM ENTRIES CAPTURED ===");
for (const ce of customEntries) {
  if (ce.customType === "opencandle-router") {
    const out = (ce.data as { output?: Record<string, unknown> }).output;
    if (out) {
      console.log(`  - opencandle-router  route=${out.route}  workflow=${out.workflow ?? "(n/a)"}`);
      console.log(
        `      entities.symbols=${JSON.stringify((out.entities as Record<string, unknown>)?.symbols)}`,
      );
    }
  } else {
    console.log(`  - ${ce.customType}`);
  }
}

const routerEntries = customEntries.filter((e) => e.customType === "opencandle-router");
console.log(`\n=== VERDICT ===`);
console.log(`  Router invocations: ${routerEntries.length}`);
if (routerEntries.length >= 2) {
  const turn2Router = routerEntries[1].data as {
    output: { entities: { symbols?: string[] } };
  };
  const turn2Symbols = turn2Router.output.entities.symbols ?? [];
  console.log(`  Turn 2 router.entities.symbols: ${JSON.stringify(turn2Symbols)}`);
  if (turn2Symbols.includes("NVDA")) {
    console.log(`  PASS: Turn 2 resolved NVDA from prior-turn context`);
  } else {
    console.log(`  FAIL: Turn 2 did not carry NVDA forward`);
  }
} else if (routerEntries.length === 1) {
  console.log(`  Only 1 router invocation — turn 2 likely took an alternate path`);
} else {
  console.log(`  No router invocations — router-mode not active or no credential`);
}

rmSync(openCandleHome, { recursive: true, force: true });
session.dispose();
process.exit(0);
