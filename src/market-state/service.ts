import type Database from "better-sqlite3";

export type AssetType = "equity" | "etf" | "fund" | "crypto" | "index" | "option" | "unknown";
export type PredictionDirection = "bullish" | "bearish" | "neutral";
export type PredictionStatus = "open" | "resolved" | "expired" | "cancelled";
export type AlertScopeType = "instrument" | "watchlist" | "portfolio";

export interface InstrumentInput {
  symbol: string;
  assetType: AssetType | string;
  name?: string | null;
  exchange?: string | null;
  currency?: string | null;
  provider: string;
  providerMetadata?: unknown;
  resolvedAt?: Date;
}

export interface CollectionRecord {
  id: number;
  name: string;
  isDefault: boolean;
  baseCurrency?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItemRecord {
  id: number;
  watchlistId: number;
  instrumentId: number;
  symbol: string;
  name: string | null;
  assetType: string;
  exchange: string | null;
  currency: string | null;
  targetPrice: number | null;
  stopPrice: number | null;
  priceCurrency: string | null;
  thesis: string | null;
  notes: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioLotRecord {
  id: number;
  portfolioId: number;
  instrumentId: number;
  symbol: string;
  name: string | null;
  assetType: string;
  exchange: string | null;
  instrumentCurrency: string | null;
  quantity: number;
  avgCost: number;
  currency: string;
  openedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PredictionRecord {
  id: number;
  instrumentId: number;
  symbol: string;
  direction: PredictionDirection;
  conviction: number;
  entryPrice: number;
  targetPrice: number | null;
  openedAt: string;
  expiresAt: string;
  status: PredictionStatus;
  resolvedAt: string | null;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleRecord {
  id: number;
  scopeType: AlertScopeType;
  scopeId: number | null;
  instrumentId: number | null;
  conditionType: string;
  conditionVersion: number;
  conditionJson: unknown;
  timeframe: string;
  enabled: boolean;
  checkIntervalSeconds: number | null;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  lastObservedJson: unknown;
  cooldownSeconds: number | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportTemplateRecord {
  id: number;
  name: string;
  reportType: string;
  cadence: string;
  timezone: string;
  localTime: string;
  configJson: unknown;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WatchlistRow {
  id: number;
  name: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface PortfolioRow extends WatchlistRow {
  base_currency: string;
}

interface InstrumentRow {
  id: number;
  symbol: string;
  asset_type: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  provider: string;
  provider_metadata_json: string | null;
  last_resolved_at: string;
  created_at: string;
  updated_at: string;
}

type WatchlistItemRow = {
  id: number;
  watchlist_id: number;
  instrument_id: number;
  symbol: string;
  name: string | null;
  asset_type: string;
  exchange: string | null;
  currency: string | null;
  target_price: number | null;
  stop_price: number | null;
  price_currency: string | null;
  thesis: string | null;
  notes: string | null;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
};

type PortfolioLotRow = {
  id: number;
  portfolio_id: number;
  instrument_id: number;
  symbol: string;
  name: string | null;
  asset_type: string;
  exchange: string | null;
  instrument_currency: string | null;
  quantity: number;
  avg_cost: number;
  currency: string;
  opened_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PredictionRow = {
  id: number;
  instrument_id: number;
  symbol: string;
  direction: PredictionDirection;
  conviction: number;
  entry_price: number;
  target_price: number | null;
  opened_at: string;
  expires_at: string;
  status: PredictionStatus;
  resolved_at: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

type AlertRuleRow = {
  id: number;
  scope_type: AlertScopeType;
  scope_id: number | null;
  instrument_id: number | null;
  condition_type: string;
  condition_version: number;
  condition_json: string;
  timeframe: string;
  enabled: number;
  check_interval_seconds: number | null;
  next_check_at: string | null;
  last_checked_at: string | null;
  last_observed_json: string | null;
  cooldown_seconds: number | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReportTemplateRow = {
  id: number;
  name: string;
  report_type: string;
  cadence: string;
  timezone: string;
  local_time: string;
  config_json: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export class MarketStateService {
  constructor(private readonly db: Database.Database) {}

  getDefaultWatchlist(): CollectionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO watchlists (name, is_default, created_at, updated_at)
         SELECT 'Default', 1, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM watchlists WHERE is_default = 1)`,
      )
      .run(now, now);

    const row = this.db
      .prepare("SELECT * FROM watchlists WHERE is_default = 1 LIMIT 1")
      .get() as WatchlistRow;
    return mapCollection(row);
  }

  getDefaultPortfolio(): CollectionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO portfolios (name, base_currency, is_default, created_at, updated_at)
         SELECT 'Default', 'USD', 1, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM portfolios WHERE is_default = 1)`,
      )
      .run(now, now);

    const row = this.db
      .prepare("SELECT * FROM portfolios WHERE is_default = 1 LIMIT 1")
      .get() as PortfolioRow;
    return {
      ...mapCollection(row),
      baseCurrency: row.base_currency,
    };
  }

  addWatchlistItem(params: {
    instrument: InstrumentInput;
    watchlistId?: number;
    targetPrice?: number;
    stopPrice?: number;
    priceCurrency?: string;
    thesis?: string;
    notes?: string;
    tags?: string[];
  }): WatchlistItemRecord {
    const tx = this.db.transaction(() => {
      const watchlistId = params.watchlistId ?? this.getDefaultWatchlist().id;
      const instrument = this.upsertInstrument(params.instrument);
      const now = new Date().toISOString();
      const existing = this.db
        .prepare(
          `SELECT id FROM watchlist_items
           WHERE watchlist_id = ? AND instrument_id = ?`,
        )
        .get(watchlistId, instrument.id) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE watchlist_items
             SET target_price = ?, stop_price = ?, price_currency = ?, thesis = ?,
                 notes = ?, tags_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            params.targetPrice ?? null,
            params.stopPrice ?? null,
            params.priceCurrency ?? params.instrument.currency ?? null,
            params.thesis ?? null,
            params.notes ?? null,
            params.tags == null ? null : JSON.stringify(params.tags),
            now,
            existing.id,
          );
        return existing.id;
      }

      const result = this.db
        .prepare(
          `INSERT INTO watchlist_items (
             watchlist_id, instrument_id, thesis, notes, tags_json,
             target_price, stop_price, price_currency, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          watchlistId,
          instrument.id,
          params.thesis ?? null,
          params.notes ?? null,
          params.tags == null ? null : JSON.stringify(params.tags),
          params.targetPrice ?? null,
          params.stopPrice ?? null,
          params.priceCurrency ?? params.instrument.currency ?? null,
          now,
          now,
        );
      return Number(result.lastInsertRowid);
    });

    return this.getWatchlistItem(tx());
  }

  listWatchlistItems(watchlistId = this.getDefaultWatchlist().id): WatchlistItemRecord[] {
    const rows = this.db
      .prepare(
        `SELECT wi.*, i.symbol, i.name, i.asset_type, i.exchange, i.currency
         FROM watchlist_items wi
         JOIN instruments i ON i.id = wi.instrument_id
         WHERE wi.watchlist_id = ?
         ORDER BY i.symbol`,
      )
      .all(watchlistId) as WatchlistItemRow[];
    return rows.map(mapWatchlistItem);
  }

  removeWatchlistItemBySymbol(symbol: string, watchlistId = this.getDefaultWatchlist().id): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM watchlist_items
         WHERE watchlist_id = ?
           AND instrument_id IN (SELECT id FROM instruments WHERE symbol = ?)`,
      )
      .run(watchlistId, symbol.trim().toUpperCase());
    return result.changes > 0;
  }

  addPortfolioLot(params: {
    instrument: InstrumentInput;
    portfolioId?: number;
    quantity: number;
    avgCost: number;
    currency: string;
    openedAt?: string;
    notes?: string;
  }): PortfolioLotRecord {
    const tx = this.db.transaction(() => {
      const portfolioId = params.portfolioId ?? this.getDefaultPortfolio().id;
      const instrument = this.upsertInstrument(params.instrument);
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO portfolio_lots (
             portfolio_id, instrument_id, quantity, avg_cost, currency,
             opened_at, notes, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          portfolioId,
          instrument.id,
          params.quantity,
          params.avgCost,
          params.currency.toUpperCase(),
          params.openedAt ?? now,
          params.notes ?? null,
          now,
          now,
        );
      return Number(result.lastInsertRowid);
    });

    return this.getPortfolioLot(tx());
  }

  listPortfolioLots(portfolioId = this.getDefaultPortfolio().id): PortfolioLotRecord[] {
    const rows = this.db
      .prepare(
        `SELECT pl.*, i.symbol, i.name, i.asset_type, i.exchange, i.currency AS instrument_currency
         FROM portfolio_lots pl
         JOIN instruments i ON i.id = pl.instrument_id
         WHERE pl.portfolio_id = ?
         ORDER BY pl.id`,
      )
      .all(portfolioId) as PortfolioLotRow[];
    return rows.map(mapPortfolioLot);
  }

  removePortfolioLotsBySymbol(symbol: string, portfolioId = this.getDefaultPortfolio().id): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM portfolio_lots
         WHERE portfolio_id = ?
           AND instrument_id IN (SELECT id FROM instruments WHERE symbol = ?)`,
      )
      .run(portfolioId, symbol.trim().toUpperCase());
    return result.changes > 0;
  }

  recordPrediction(params: {
    instrument: InstrumentInput;
    direction: PredictionDirection;
    conviction: number;
    entryPrice: number;
    targetPrice?: number;
    timeframeDays: number;
    now?: Date;
  }): PredictionRecord {
    const tx = this.db.transaction(() => {
      const instrument = this.upsertInstrument(params.instrument);
      const opened = params.now ?? new Date();
      const expires = new Date(opened);
      expires.setDate(expires.getDate() + params.timeframeDays);
      const nowIso = opened.toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO prediction_records (
             instrument_id, direction, conviction, entry_price, target_price,
             opened_at, expires_at, status, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(
          instrument.id,
          params.direction,
          params.conviction,
          params.entryPrice,
          params.targetPrice ?? null,
          nowIso,
          expires.toISOString(),
          nowIso,
          nowIso,
        );
      return Number(result.lastInsertRowid);
    });

    return this.getPrediction(tx());
  }

  listPredictions(): PredictionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT pr.*, i.symbol
         FROM prediction_records pr
         JOIN instruments i ON i.id = pr.instrument_id
         ORDER BY pr.opened_at, pr.id`,
      )
      .all() as PredictionRow[];
    return rows.map(mapPrediction);
  }

  createAlertRule(params: {
    scopeType: AlertScopeType;
    scopeId?: number;
    instrumentId?: number;
    conditionType: string;
    conditionVersion: number;
    condition: unknown;
    timeframe: string;
    enabled?: boolean;
    checkIntervalSeconds?: number;
    nextCheckAt?: string;
    cooldownSeconds?: number;
  }): AlertRuleRecord {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO alert_rules (
           scope_type, scope_id, instrument_id, condition_type, condition_version,
           condition_json, timeframe, enabled, check_interval_seconds, next_check_at,
           cooldown_seconds, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.scopeType,
        params.scopeId ?? null,
        params.instrumentId ?? null,
        params.conditionType,
        params.conditionVersion,
        JSON.stringify(params.condition),
        params.timeframe,
        params.enabled === false ? 0 : 1,
        params.checkIntervalSeconds ?? null,
        params.nextCheckAt ?? null,
        params.cooldownSeconds ?? null,
        now,
        now,
      );
    return this.getAlertRule(Number(result.lastInsertRowid));
  }

  listAlertRules(): AlertRuleRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM alert_rules ORDER BY created_at, id")
      .all() as AlertRuleRow[];
    return rows.map(mapAlertRule);
  }

  createReportTemplate(params: {
    name: string;
    reportType: string;
    cadence: string;
    timezone: string;
    localTime: string;
    config: unknown;
    enabled?: boolean;
    nextRunAt?: string;
  }): ReportTemplateRecord {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO report_templates (
           name, report_type, cadence, timezone, local_time, config_json,
           enabled, next_run_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.name,
        params.reportType,
        params.cadence,
        params.timezone,
        params.localTime,
        JSON.stringify(params.config),
        params.enabled === false ? 0 : 1,
        params.nextRunAt ?? null,
        now,
        now,
      );
    return this.getReportTemplate(Number(result.lastInsertRowid));
  }

  private upsertInstrument(input: InstrumentInput): InstrumentRow {
    const symbol = input.symbol.trim().toUpperCase();
    const assetType = input.assetType.trim().toLowerCase();
    const provider = input.provider.trim().toLowerCase();
    const exchange = normalizeNullable(input.exchange);
    const now = new Date().toISOString();
    const resolvedAt = (input.resolvedAt ?? new Date()).toISOString();

    const existing = this.db
      .prepare(
        `SELECT * FROM instruments
         WHERE provider = ?
           AND symbol = ?
           AND asset_type = ?
           AND IFNULL(exchange, '') = IFNULL(?, '')`,
      )
      .get(provider, symbol, assetType, exchange) as InstrumentRow | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE instruments
           SET name = ?, currency = ?, provider_metadata_json = ?,
               last_resolved_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          normalizeNullable(input.name),
          normalizeNullable(input.currency)?.toUpperCase() ?? null,
          input.providerMetadata == null ? null : JSON.stringify(input.providerMetadata),
          resolvedAt,
          now,
          existing.id,
        );
      return this.db.prepare("SELECT * FROM instruments WHERE id = ?").get(existing.id) as InstrumentRow;
    }

    const result = this.db
      .prepare(
        `INSERT INTO instruments (
           symbol, asset_type, name, exchange, currency, provider,
           provider_metadata_json, last_resolved_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        symbol,
        assetType,
        normalizeNullable(input.name),
        exchange,
        normalizeNullable(input.currency)?.toUpperCase() ?? null,
        provider,
        input.providerMetadata == null ? null : JSON.stringify(input.providerMetadata),
        resolvedAt,
        now,
        now,
      );
    return this.db.prepare("SELECT * FROM instruments WHERE id = ?").get(result.lastInsertRowid) as InstrumentRow;
  }

  private getWatchlistItem(id: number): WatchlistItemRecord {
    const row = this.db
      .prepare(
        `SELECT wi.*, i.symbol, i.name, i.asset_type, i.exchange, i.currency
         FROM watchlist_items wi
         JOIN instruments i ON i.id = wi.instrument_id
         WHERE wi.id = ?`,
      )
      .get(id) as WatchlistItemRow;
    return mapWatchlistItem(row);
  }

  private getPortfolioLot(id: number): PortfolioLotRecord {
    const row = this.db
      .prepare(
        `SELECT pl.*, i.symbol, i.name, i.asset_type, i.exchange, i.currency AS instrument_currency
         FROM portfolio_lots pl
         JOIN instruments i ON i.id = pl.instrument_id
         WHERE pl.id = ?`,
      )
      .get(id) as PortfolioLotRow;
    return mapPortfolioLot(row);
  }

  private getPrediction(id: number): PredictionRecord {
    const row = this.db
      .prepare(
        `SELECT pr.*, i.symbol
         FROM prediction_records pr
         JOIN instruments i ON i.id = pr.instrument_id
         WHERE pr.id = ?`,
      )
      .get(id) as PredictionRow;
    return mapPrediction(row);
  }

  private getAlertRule(id: number): AlertRuleRecord {
    const row = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRuleRow;
    return mapAlertRule(row);
  }

  private getReportTemplate(id: number): ReportTemplateRecord {
    const row = this.db
      .prepare("SELECT * FROM report_templates WHERE id = ?")
      .get(id) as ReportTemplateRow;
    return mapReportTemplate(row);
  }
}

function mapCollection(row: WatchlistRow): CollectionRecord {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWatchlistItem(row: WatchlistItemRow): WatchlistItemRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    name: row.name,
    assetType: row.asset_type,
    exchange: row.exchange,
    currency: row.currency,
    targetPrice: row.target_price,
    stopPrice: row.stop_price,
    priceCurrency: row.price_currency,
    thesis: row.thesis,
    notes: row.notes,
    tags: row.tags_json == null ? null : JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPortfolioLot(row: PortfolioLotRow): PortfolioLotRecord {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    name: row.name,
    assetType: row.asset_type,
    exchange: row.exchange,
    instrumentCurrency: row.instrument_currency,
    quantity: row.quantity,
    avgCost: row.avg_cost,
    currency: row.currency,
    openedAt: row.opened_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrediction(row: PredictionRow): PredictionRecord {
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    direction: row.direction,
    conviction: row.conviction,
    entryPrice: row.entry_price,
    targetPrice: row.target_price,
    openedAt: row.opened_at,
    expiresAt: row.expires_at,
    status: row.status,
    resolvedAt: row.resolved_at,
    resultJson: row.result_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertRule(row: AlertRuleRow): AlertRuleRecord {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    instrumentId: row.instrument_id,
    conditionType: row.condition_type,
    conditionVersion: row.condition_version,
    conditionJson: JSON.parse(row.condition_json),
    timeframe: row.timeframe,
    enabled: row.enabled === 1,
    checkIntervalSeconds: row.check_interval_seconds,
    nextCheckAt: row.next_check_at,
    lastCheckedAt: row.last_checked_at,
    lastObservedJson: row.last_observed_json == null ? null : JSON.parse(row.last_observed_json),
    cooldownSeconds: row.cooldown_seconds,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReportTemplate(row: ReportTemplateRow): ReportTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    reportType: row.report_type,
    cadence: row.cadence,
    timezone: row.timezone,
    localTime: row.local_time,
    configJson: JSON.parse(row.config_json),
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
