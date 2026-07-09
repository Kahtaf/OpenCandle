import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketStateService } from "../../src/market-state/service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";
import type { SeededMarketStateFixture } from "./competitive-finance.js";
import type { EvalCase, EvalTrace } from "./types.js";

/**
 * Runs an eval case through the OpenCandle harness and returns the trace.
 */
export async function runEvalCase(evalCase: EvalCase): Promise<EvalTrace> {
  const fixture = evalCase.savedMarketStateFixture;
  const seededHome = fixture ? mkdtempSync(join(tmpdir(), "oc-eval-state-")) : undefined;

  if (seededHome) {
    const previousHome = process.env.OPENCANDLE_HOME;
    process.env.OPENCANDLE_HOME = seededHome;
    try {
      seedOpenCandleHomeMarketState(fixture);
    } catch (error) {
      rmSync(seededHome, { recursive: true, force: true });
      throw error;
    } finally {
      if (previousHome === undefined) {
        delete process.env.OPENCANDLE_HOME;
      } else {
        process.env.OPENCANDLE_HOME = previousHome;
      }
    }
  }

  try {
    const result = await runOpenCandleSession({
      prompt: evalCase.prompt,
      scriptedAnswers: evalCase.answers,
      openCandleHome: seededHome,
      timeoutMs: 600_000,
    });
    return result.evalTrace;
  } finally {
    if (seededHome) {
      rmSync(seededHome, { recursive: true, force: true });
    }
  }
}

export function seedOpenCandleHomeMarketState(fixture: SeededMarketStateFixture): void {
  const db = initDefaultDatabase();
  try {
    const service = new MarketStateService(db);
    for (const lot of fixture.lots) {
      service.addPortfolioLot({
        instrument: {
          symbol: lot.symbol,
          name: lot.name,
          assetType: lot.assetType,
          currency: "USD",
          provider: "eval-fixture",
        },
        quantity: lot.quantity,
        avgCost: lot.avgCost,
        currency: "USD",
        source: "eval-fixture",
      });
    }
    for (const item of fixture.watchlist) {
      service.addWatchlistItem({
        instrument: {
          symbol: item.symbol,
          name: item.name,
          assetType: "equity",
          currency: "USD",
          provider: "eval-fixture",
        },
        source: "eval-fixture",
      });
    }
  } finally {
    db.close();
  }
}
