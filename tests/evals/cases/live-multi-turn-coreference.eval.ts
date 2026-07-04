import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../../src/config.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { runOpenCandleSession } from "../../harness/opencandle-runner.js";
import type { CustomEntryTrace } from "../../harness/types.js";

const LIVE_MULTI_TURN_FLAG = "OPENCANDLE_LIVE_MULTI_TURN_EVAL";
const KNOWN_FAIL_FLAG = "OPENCANDLE_RUN_KNOWN_FAIL_EVALS";
const shouldRun =
  process.env.EVAL_TIER === "usually" &&
  process.env[LIVE_MULTI_TURN_FLAG] === "1" &&
  process.env[KNOWN_FAIL_FLAG] === "1";

const runOrSkip = shouldRun ? it : it.skip;

describe("E1 live multi-turn coreference eval", () => {
  // FINDING(E1-multi-turn-coreference): on the 2026-07-04 live run, turn 3
  // carried prior-turn NVDA in router entities but did not add the saved AMD
  // holding for "the one I hold". Keep this usually-tier live case known-fail
  // until saved-state coreference is fixed outside this eval-authoring PR.
  runOrSkip(
    "KNOWN-FAIL E1: resolves prior-turn price coreference and saved-state holding references in router trace evidence",
    async () => {
      loadEnv();
      const openCandleHome = mkdtempSync(join(tmpdir(), "oc-e1-multi-turn-home-"));
      try {
        seedAmdPortfolio(openCandleHome);

        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);
        const { evalTrace } = await runOpenCandleSession({
          prompts: [
            "tell me about NVDA",
            "what about at $500?",
            "and compare it to the one I hold",
          ],
          openCandleHome,
          authStorage,
          modelRegistry,
          defaultProvider: process.env.OPENCANDLE_EVAL_MODEL_PROVIDER ?? "google",
          defaultModel: process.env.OPENCANDLE_EVAL_MODEL ?? "gemini-2.5-flash",
          settleGraceMs: 15_000,
          timeoutMs: 900_000,
        });

        const routerEntries = customEntriesByType(evalTrace.customEntries, "opencandle-router");
        const routeContextEntries = customEntriesByType(
          evalTrace.customEntries,
          "opencandle-route-context",
        );

        expect(routerEntries.length).toBeGreaterThanOrEqual(3);
        expect(routeContextEntries.length).toBeGreaterThanOrEqual(3);

        const turn2Router = latestEntryForPrompt(routerEntries, 1);
        const turn3Router = latestEntryForPrompt(routerEntries, 2);
        const turn2Context = latestEntryForPrompt(routeContextEntries, 1);
        const turn3Context = latestEntryForPrompt(routeContextEntries, 2);

        expect(symbolsFromRouterEntry(turn2Router)).toContain("NVDA");
        expect(symbolsFromRouterEntry(turn3Router)).toEqual(
          expect.arrayContaining(["NVDA", "AMD"]),
        );
        // Shipped contract (src/routing/types.ts SlotSource): prior-turn
        // symbols MAY appear in slots but must carry source "prior_context"
        // (or preference/memory) — never "user". The original assertion
        // ("prior-turn symbols never land in slots") predates the shipped
        // prior_context provenance and was also vacuous: it read slot values
        // through a string-only extractor that missed the
        // {value, source, confidence} slot shape entirely.
        expect(userSourcedSlotSymbols(turn2Router)).not.toContain("NVDA");
        const turn3UserSlotSymbols = userSourcedSlotSymbols(turn3Router);
        expect(turn3UserSlotSymbols).not.toContain("NVDA");
        expect(turn3UserSlotSymbols).not.toContain("AMD");

        expect(slotSourcesFromContext(turn2Context)).toEqual(expect.arrayContaining(["user"]));
        expect(slotSourcesFromContext(turn3Context)).toEqual(expect.arrayContaining(["user"]));
        expect(
          priorTurnsFromContext(turn2Context)
            .map((turn) => turn.text)
            .join("\n"),
        ).toMatch(/tell me about NVDA/i);
        const turn3PriorTurns = priorTurnsFromContext(turn3Context)
          .map((turn) => turn.text)
          .join("\n");
        expect(turn3PriorTurns).toMatch(/tell me about NVDA/i);
        expect(turn3PriorTurns).toMatch(/what about at \$500/i);
      } finally {
        rmSync(openCandleHome, { recursive: true, force: true });
      }
    },
    900_000,
  );

  if (!shouldRun) {
    it.skip(`skipped — run with EVAL_TIER=usually ${LIVE_MULTI_TURN_FLAG}=1 ${KNOWN_FAIL_FLAG}=1 for the known-fail live E1 case`, () => {});
  }
});

function seedAmdPortfolio(openCandleHome: string): void {
  const db = initDatabase(join(openCandleHome, "state.db"));
  try {
    const service = new MarketStateService(db);
    service.addPortfolioLot({
      instrument: {
        symbol: "AMD",
        name: "Advanced Micro Devices, Inc.",
        assetType: "equity",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 25,
      avgCost: 120,
      currency: "USD",
    });
  } finally {
    db.close();
  }
}

function customEntriesByType(
  entries: CustomEntryTrace[] | undefined,
  customType: string,
): CustomEntryTrace[] {
  return (entries ?? []).filter((entry) => entry.customType === customType);
}

function latestEntryForPrompt(entries: CustomEntryTrace[], promptIndex: number): CustomEntryTrace {
  const entry = entries.filter((candidate) => candidate.promptIndex === promptIndex).at(-1);
  if (!entry)
    throw new Error(`missing ${entries[0]?.customType ?? "custom"} prompt ${promptIndex}`);
  return entry;
}

function symbolsFromRouterEntry(entry: CustomEntryTrace): string[] {
  const output = routerOutput(entry);
  const entities = recordOrNull(output.entities);
  return stringArray(entities?.symbols).map((symbol) => symbol.toUpperCase());
}

function userSourcedSlotSymbols(entry: CustomEntryTrace): string[] {
  const output = routerOutput(entry);
  const slots = recordOrNull(output.slots);
  if (!slots) return [];
  const symbols = new Set<string>();
  for (const key of ["symbol", "symbols"]) {
    const slot = recordOrNull(slots[key]);
    // Router slots are {value, source, confidence} objects; a plain string
    // fallback keeps older trace shapes readable.
    const source = typeof slot?.source === "string" ? slot.source : "user";
    if (source !== "user") continue;
    const rawValue = slot ? slot.value : slots[key];
    for (const value of stringsFromUnknown(rawValue)) {
      symbols.add(value.toUpperCase());
    }
  }
  return [...symbols];
}

function slotSourcesFromContext(entry: CustomEntryTrace): string[] {
  const context = recordOrThrow(entry.data, "route context");
  // The route-context entry's key is `slots`; `resolvedSlots` is kept as a
  // fallback for older traces (the original assertion read only the
  // nonexistent key and failed unconditionally).
  const resolvedSlots = recordOrNull(context.slots) ?? recordOrNull(context.resolvedSlots);
  if (!resolvedSlots) return [];
  const sources = new Set<string>();
  for (const value of Object.values(resolvedSlots)) {
    const slot = recordOrNull(value);
    const source = typeof slot?.source === "string" ? slot.source : undefined;
    if (source) sources.add(source);
  }
  return [...sources];
}

function priorTurnsFromContext(entry: CustomEntryTrace): Array<{ role: string; text: string }> {
  const context = recordOrThrow(entry.data, "route context");
  const priorTurns = Array.isArray(context.priorTurns) ? context.priorTurns : [];
  return priorTurns.flatMap((turn) => {
    const record = recordOrNull(turn);
    if (typeof record?.role !== "string" || typeof record.text !== "string") return [];
    return [{ role: record.role, text: record.text }];
  });
}

function routerOutput(entry: CustomEntryTrace): Record<string, unknown> {
  const data = recordOrThrow(entry.data, "router entry data");
  return recordOrThrow(data.output, "router output");
}

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordOrThrow(value: unknown, label: string): Record<string, unknown> {
  const record = recordOrNull(value);
  if (!record) throw new Error(`expected ${label} to be an object`);
  return record;
}
