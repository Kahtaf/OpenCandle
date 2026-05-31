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
  aliases?: InstrumentAliasInput[];
}

export interface InstrumentAliasInput {
  source: string;
  sourceSymbol: string;
  sourceExchange?: string | null;
  sourceAssetType?: string | null;
  sourceId?: string | null;
  raw?: unknown;
}

export interface InstrumentAliasLookup {
  source: string;
  sourceSymbol?: string;
  sourceExchange?: string | null;
  sourceAssetType?: string | null;
  sourceId?: string | null;
}

export interface CollectionRecord {
  id: number;
  name: string;
  isDefault: boolean;
  baseCurrency?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentRecord {
  id: number;
  symbol: string;
  assetType: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  provider: string;
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
  source: string | null;
  sourceRowId: string | null;
  sourceMetadata: unknown;
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
  source: string | null;
  sourceAccountRef: string | null;
  sourceLotId: string | null;
  sourceRowId: string | null;
  sourceMetadata: unknown;
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

export interface AlertEventRecord {
  id: number;
  alertRuleId: number;
  instrumentId: number | null;
  observedValueJson: unknown;
  triggeredAt: string;
  status: string;
  message: string | null;
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

export interface ReportRunRecord {
  id: number;
  templateId: number | null;
  startedAt: string;
  completedAt: string | null;
  status: string;
  artifactPath: string | null;
  summaryJson: unknown;
  errorsJson: unknown;
}

export interface ImportBatchRecord {
  id: number;
  source: string;
  sourceLabel: string | null;
  importedAt: string;
  status: string;
  rawMetadata: unknown;
}

export interface ImportRowRecord {
  id: number;
  batchId: number;
  rowType: string;
  sourceSymbol: string | null;
  sourceRowId: string | null;
  sourceAccountRef: string | null;
  normalizedInstrumentId: number | null;
  status: string;
  error: string | null;
  sourceMetadata: unknown;
  raw: unknown;
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

interface InstrumentAliasRow {
  id: number;
  instrument_id: number;
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
  source: string | null;
  source_row_id: string | null;
  source_metadata_json: string | null;
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
  source: string | null;
  source_account_ref: string | null;
  source_lot_id: string | null;
  source_row_id: string | null;
  source_metadata_json: string | null;
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

type AlertEventRow = {
  id: number;
  alert_rule_id: number;
  instrument_id: number | null;
  observed_value_json: string | null;
  triggered_at: string;
  status: string;
  message: string | null;
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

type ReportRunRow = {
  id: number;
  template_id: number | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  artifact_path: string | null;
  summary_json: string | null;
  errors_json: string | null;
};

type ImportBatchRow = {
  id: number;
  source: string;
  source_label: string | null;
  imported_at: string;
  status: string;
  raw_metadata_json: string | null;
};

type ImportRowRow = {
  id: number;
  batch_id: number;
  row_type: string;
  source_symbol: string | null;
  source_row_id: string | null;
  source_account_ref: string | null;
  normalized_instrument_id: number | null;
  status: string;
  error: string | null;
  source_metadata_json: string | null;
  raw_json: string | null;
};

export class MarketStateService {
  constructor(private readonly db: Database.Database) {}

  getDefaultWatchlist(): CollectionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO watchlists (name, is_default, created_at, updated_at)
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
        `INSERT OR IGNORE INTO portfolios (name, base_currency, is_default, created_at, updated_at)
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

  findInstrumentByAlias(lookup: InstrumentAliasLookup): InstrumentRecord | null {
    const source = normalizeSource(lookup.source);
    const sourceId = normalizeNullable(lookup.sourceId);
    const alias = sourceId == null
      ? this.db
        .prepare(
          `SELECT id, instrument_id FROM instrument_aliases
           WHERE source = ?
             AND source_symbol = ?
             AND IFNULL(source_exchange, '') = IFNULL(?, '')
             AND IFNULL(source_asset_type, '') = IFNULL(?, '')
           LIMIT 1`,
        )
        .get(
          source,
          normalizeSourceSymbol(lookup.sourceSymbol ?? ""),
          normalizeExchange(lookup.sourceExchange),
          normalizeAssetType(lookup.sourceAssetType),
        ) as InstrumentAliasRow | undefined
      : this.db
        .prepare(
          `SELECT id, instrument_id FROM instrument_aliases
           WHERE source = ? AND source_id = ?
           LIMIT 1`,
        )
        .get(source, sourceId) as InstrumentAliasRow | undefined;

    if (alias == null) return null;

    const row = this.db
      .prepare("SELECT * FROM instruments WHERE id = ?")
      .get(alias.instrument_id) as InstrumentRow | undefined;
    return row == null ? null : mapInstrument(row);
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
    source?: string;
    sourceRowId?: string;
    sourceMetadata?: unknown;
  }): WatchlistItemRecord {
    const tx = this.db.transaction(() => {
      const watchlistId = params.watchlistId ?? this.getDefaultWatchlist().id;
      const instrument = this.upsertInstrument(params.instrument);
      const now = new Date().toISOString();
      const existing = this.db
        .prepare(
          `SELECT * FROM watchlist_items
           WHERE watchlist_id = ? AND instrument_id = ?`,
        )
        .get(watchlistId, instrument.id) as WatchlistItemRow | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE watchlist_items
             SET target_price = ?, stop_price = ?, price_currency = ?, thesis = ?,
                 notes = ?, tags_json = ?, source = ?, source_row_id = ?,
                 source_metadata_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            params.targetPrice ?? existing.target_price,
            params.stopPrice ?? existing.stop_price,
            params.priceCurrency ?? existing.price_currency,
            params.thesis ?? existing.thesis,
            params.notes ?? existing.notes,
            params.tags == null ? existing.tags_json : JSON.stringify(params.tags),
            params.source === undefined ? existing.source : normalizeNullable(params.source),
            params.sourceRowId === undefined ? existing.source_row_id : normalizeNullable(params.sourceRowId),
            params.sourceMetadata === undefined
              ? existing.source_metadata_json
              : params.sourceMetadata == null
                ? null
                : JSON.stringify(params.sourceMetadata),
            now,
            existing.id,
          );
        return existing.id;
      }

      const result = this.db
        .prepare(
          `INSERT INTO watchlist_items (
             watchlist_id, instrument_id, thesis, notes, tags_json,
             target_price, stop_price, price_currency, source, source_row_id,
             source_metadata_json, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          normalizeNullable(params.source),
          normalizeNullable(params.sourceRowId),
          params.sourceMetadata == null ? null : JSON.stringify(params.sourceMetadata),
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

  updateWatchlistItemBySymbol(
    symbol: string,
    params: {
      watchlistId?: number;
      targetPrice?: number;
      stopPrice?: number;
      priceCurrency?: string;
      thesis?: string;
      notes?: string;
      tags?: string[];
    },
  ): WatchlistItemRecord | null {
    const watchlistId = params.watchlistId ?? this.getDefaultWatchlist().id;
    const existing = this.db
      .prepare(
        `SELECT wi.*
         FROM watchlist_items wi
         JOIN instruments i ON i.id = wi.instrument_id
         WHERE wi.watchlist_id = ? AND i.symbol = ?
         LIMIT 1`,
      )
      .get(watchlistId, symbol.trim().toUpperCase()) as WatchlistItemRow | undefined;
    if (existing == null) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE watchlist_items
         SET target_price = ?, stop_price = ?, price_currency = ?, thesis = ?,
             notes = ?, tags_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        params.targetPrice ?? existing.target_price,
        params.stopPrice ?? existing.stop_price,
        params.priceCurrency ?? existing.price_currency,
        params.thesis ?? existing.thesis,
        params.notes ?? existing.notes,
        params.tags == null ? existing.tags_json : JSON.stringify(params.tags),
        now,
        existing.id,
      );
    return this.getWatchlistItem(existing.id);
  }

  addPortfolioLot(params: {
    instrument: InstrumentInput;
    portfolioId?: number;
    quantity: number;
    avgCost: number;
    currency: string;
    openedAt?: string;
    notes?: string;
    source?: string;
    sourceAccountRef?: string;
    sourceLotId?: string;
    sourceRowId?: string;
    sourceMetadata?: unknown;
  }): PortfolioLotRecord {
    const tx = this.db.transaction(() => {
      const portfolioId = params.portfolioId ?? this.getDefaultPortfolio().id;
      const instrument = this.upsertInstrument(params.instrument);
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO portfolio_lots (
             portfolio_id, instrument_id, quantity, avg_cost, currency,
             opened_at, notes, source, source_account_ref, source_lot_id,
             source_row_id, source_metadata_json, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          portfolioId,
          instrument.id,
          params.quantity,
          params.avgCost,
          params.currency.toUpperCase(),
          params.openedAt ?? now,
          params.notes ?? null,
          normalizeNullable(params.source),
          normalizeNullable(params.sourceAccountRef),
          normalizeNullable(params.sourceLotId),
          normalizeNullable(params.sourceRowId),
          params.sourceMetadata == null ? null : JSON.stringify(params.sourceMetadata),
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

  removePortfolioLot(id: number): PortfolioLotRecord | null {
    const existing = this.getPortfolioLotOrNull(id);
    if (existing == null) return null;
    this.db.prepare("DELETE FROM portfolio_lots WHERE id = ?").run(id);
    return existing;
  }

  updatePortfolioLot(
    id: number,
    params: {
      quantity?: number;
      avgCost?: number;
      currency?: string;
      openedAt?: string;
      notes?: string;
    },
  ): PortfolioLotRecord | null {
    const existing = this.db.prepare("SELECT * FROM portfolio_lots WHERE id = ?").get(id) as
      | PortfolioLotRow
      | undefined;
    if (existing == null) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE portfolio_lots
         SET quantity = ?, avg_cost = ?, currency = ?, opened_at = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        params.quantity ?? existing.quantity,
        params.avgCost ?? existing.avg_cost,
        params.currency == null ? existing.currency : params.currency.toUpperCase(),
        params.openedAt ?? existing.opened_at,
        params.notes ?? existing.notes,
        now,
        id,
      );
    return this.getPortfolioLot(id);
  }

  updatePortfolioLotsBySymbol(
    symbol: string,
    params: {
      portfolioId?: number;
      quantity?: number;
      avgCost?: number;
      currency?: string;
      openedAt?: string;
      notes?: string;
    },
  ): PortfolioLotRecord[] {
    const portfolioId = params.portfolioId ?? this.getDefaultPortfolio().id;
    const rows = this.db
      .prepare(
        `SELECT pl.*
         FROM portfolio_lots pl
         JOIN instruments i ON i.id = pl.instrument_id
         WHERE pl.portfolio_id = ? AND i.symbol = ?
         ORDER BY pl.id`,
      )
      .all(portfolioId, symbol.trim().toUpperCase()) as PortfolioLotRow[];
    return rows.flatMap((row) => {
      const updated = this.updatePortfolioLot(row.id, params);
      return updated == null ? [] : [updated];
    });
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

  updatePredictionOutcome(params: {
    id: number;
    status: Exclude<PredictionStatus, "open">;
    resolvedAt: string;
    result: unknown;
  }): PredictionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE prediction_records
         SET status = ?, resolved_at = ?, result_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(params.status, params.resolvedAt, JSON.stringify(params.result), now, params.id);
    return this.getPrediction(params.id);
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

  setAlertRuleEnabled(id: number, enabled: boolean): AlertRuleRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE alert_rules
         SET enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, now, id);
    return this.getAlertRule(id);
  }

  getInstrument(id: number): InstrumentRecord | null {
    const row = this.db.prepare("SELECT * FROM instruments WHERE id = ?").get(id) as
      | InstrumentRow
      | undefined;
    return row == null ? null : mapInstrument(row);
  }

  upsertInstrumentRecord(input: InstrumentInput): InstrumentRecord {
    return mapInstrument(this.upsertInstrument(input));
  }

  updateAlertObservation(params: {
    ruleId: number;
    observed: unknown;
    checkedAt?: string;
    triggeredAt?: string;
  }): AlertRuleRecord {
    const checkedAt = params.checkedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE alert_rules
         SET last_checked_at = ?,
             last_observed_json = ?,
             last_triggered_at = COALESCE(?, last_triggered_at),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        checkedAt,
        JSON.stringify(params.observed),
        params.triggeredAt ?? null,
        checkedAt,
        params.ruleId,
      );
    return this.getAlertRule(params.ruleId);
  }

  recordAlertEvent(params: {
    alertRuleId: number;
    instrumentId?: number | null;
    observedValue: unknown;
    status: string;
    message: string;
    triggeredAt?: string;
  }): AlertEventRecord {
    const triggeredAt = params.triggeredAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO alert_events (
           alert_rule_id, instrument_id, observed_value_json, triggered_at, status, message
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.alertRuleId,
        params.instrumentId ?? null,
        JSON.stringify(params.observedValue),
        triggeredAt,
        params.status,
        params.message,
      );
    return this.getAlertEvent(Number(result.lastInsertRowid));
  }

  recordAlertCheckResult(params: {
    ruleId: number;
    observed: unknown;
    checkedAt: string;
    trigger?: {
      expectedPreviousValue: number | null;
      expectedLastTriggeredAt: string | null;
      instrumentId: number | null;
      message: string;
      triggeredAt: string;
    };
  }): { triggered: boolean; rule: AlertRuleRecord } {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(params.ruleId) as
        | AlertRuleRow
        | undefined;
      if (row == null) {
        throw new Error(`alert rule ${params.ruleId} not found`);
      }

      const currentPrevious = lastObservedValueFromJson(row.last_observed_json);
      const currentLastTriggeredAt = row.last_triggered_at ?? null;
      const canTrigger = params.trigger != null &&
        currentPrevious === params.trigger.expectedPreviousValue &&
        currentLastTriggeredAt === params.trigger.expectedLastTriggeredAt;

      if (canTrigger && params.trigger) {
        this.db
          .prepare(
            `INSERT INTO alert_events (
               alert_rule_id, instrument_id, observed_value_json, triggered_at, status, message
             )
             VALUES (?, ?, ?, ?, 'triggered', ?)`,
          )
          .run(
            params.ruleId,
            params.trigger.instrumentId,
            JSON.stringify(params.observed),
            params.trigger.triggeredAt,
            params.trigger.message,
          );
      }

      this.db
        .prepare(
          `UPDATE alert_rules
           SET last_checked_at = ?,
               last_observed_json = ?,
               last_triggered_at = COALESCE(?, last_triggered_at),
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          params.checkedAt,
          JSON.stringify(params.observed),
          canTrigger && params.trigger ? params.trigger.triggeredAt : null,
          params.checkedAt,
          params.ruleId,
        );

      return canTrigger;
    });
    const triggered = tx();
    return { triggered, rule: this.getAlertRule(params.ruleId) };
  }

  recordAlertUnavailable(params: {
    ruleId: number;
    instrumentId?: number | null;
    reason: string;
    checkedAt: string;
  }): { event: AlertEventRecord; rule: AlertRuleRecord } {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM alert_rules WHERE id = ?").get(params.ruleId) as
        | { id: number }
        | undefined;
      if (row == null) {
        throw new Error(`alert rule ${params.ruleId} not found`);
      }

      const result = this.db
        .prepare(
          `INSERT INTO alert_events (
             alert_rule_id, instrument_id, observed_value_json, triggered_at, status, message
           )
           VALUES (?, ?, ?, ?, 'unavailable', ?)`,
        )
        .run(
          params.ruleId,
          params.instrumentId ?? null,
          JSON.stringify({ status: "unavailable", reason: params.reason, at: params.checkedAt }),
          params.checkedAt,
          `Alert unavailable: ${params.reason}`,
        );

      this.db
        .prepare(
          `UPDATE alert_rules
           SET last_checked_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(params.checkedAt, params.checkedAt, params.ruleId);

      return Number(result.lastInsertRowid);
    });
    const eventId = tx();
    return { event: this.getAlertEvent(eventId), rule: this.getAlertRule(params.ruleId) };
  }

  listAlertEvents(): AlertEventRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM alert_events ORDER BY triggered_at, id")
      .all() as AlertEventRow[];
    return rows.map(mapAlertEvent);
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

  updateReportTemplate(id: number, params: {
    name?: string;
    reportType?: string;
    cadence?: string;
    timezone?: string;
    localTime?: string;
    config?: unknown;
    enabled?: boolean;
    nextRunAt?: string | null;
  }): ReportTemplateRecord {
    const existing = this.getReportTemplate(id);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE report_templates
         SET name = ?, report_type = ?, cadence = ?, timezone = ?, local_time = ?,
             config_json = ?, enabled = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        params.name ?? existing.name,
        params.reportType ?? existing.reportType,
        params.cadence ?? existing.cadence,
        params.timezone ?? existing.timezone,
        params.localTime ?? existing.localTime,
        JSON.stringify(params.config ?? existing.configJson),
        params.enabled == null ? (existing.enabled ? 1 : 0) : params.enabled ? 1 : 0,
        params.nextRunAt === undefined ? existing.nextRunAt : params.nextRunAt,
        now,
        id,
      );
    return this.getReportTemplate(id);
  }

  listReportTemplates(): ReportTemplateRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM report_templates ORDER BY created_at, id")
      .all() as ReportTemplateRow[];
    return rows.map(mapReportTemplate);
  }

  recordReportRun(params: {
    templateId?: number | null;
    startedAt?: string;
    completedAt?: string | null;
    status: string;
    artifactPath?: string | null;
    summary?: unknown;
    errors?: unknown;
  }): ReportRunRecord {
    const startedAt = params.startedAt ?? new Date().toISOString();
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO report_runs (
             template_id, started_at, completed_at, status, artifact_path, summary_json, errors_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.templateId ?? null,
          startedAt,
          params.completedAt ?? null,
          params.status,
          params.artifactPath ?? null,
          params.summary == null ? null : JSON.stringify(params.summary),
          params.errors == null ? null : JSON.stringify(params.errors),
        );

      if (params.templateId != null) {
        this.db
          .prepare("UPDATE report_templates SET last_run_at = ?, updated_at = ? WHERE id = ?")
          .run(startedAt, startedAt, params.templateId);
      }

      return Number(result.lastInsertRowid);
    });
    return this.getReportRun(tx());
  }

  listReportRuns(): ReportRunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM report_runs ORDER BY started_at DESC, id DESC")
      .all() as ReportRunRow[];
    return rows.map(mapReportRun);
  }

  recordImportBatch(params: {
    source: string;
    sourceLabel?: string;
    importedAt?: string;
    status: string;
    rawMetadata?: unknown;
  }): ImportBatchRecord {
    const importedAt = params.importedAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO import_batches (
           source, source_label, imported_at, status, raw_metadata_json
         )
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        normalizeNullable(params.source) ?? "unknown",
        normalizeNullable(params.sourceLabel),
        importedAt,
        params.status,
        params.rawMetadata == null ? null : JSON.stringify(params.rawMetadata),
      );
    return this.getImportBatch(Number(result.lastInsertRowid));
  }

  recordImportRow(params: {
    batchId: number;
    rowType: string;
    sourceSymbol?: string;
    sourceRowId?: string;
    sourceAccountRef?: string;
    normalizedInstrumentId?: number | null;
    status: string;
    error?: string;
    sourceMetadata?: unknown;
    raw?: unknown;
  }): ImportRowRecord {
    const result = this.db
      .prepare(
        `INSERT INTO import_rows (
           batch_id, row_type, source_symbol, source_row_id, source_account_ref,
           normalized_instrument_id, status, error, source_metadata_json, raw_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.batchId,
        params.rowType,
        normalizeNullable(params.sourceSymbol),
        normalizeNullable(params.sourceRowId),
        normalizeNullable(params.sourceAccountRef),
        params.normalizedInstrumentId ?? null,
        params.status,
        normalizeNullable(params.error),
        params.sourceMetadata == null ? null : JSON.stringify(params.sourceMetadata),
        params.raw == null ? null : JSON.stringify(params.raw),
      );
    return this.getImportRow(Number(result.lastInsertRowid));
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
      this.upsertInstrumentAliases(existing.id, input.aliases ?? []);
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
    const instrumentId = Number(result.lastInsertRowid);
    this.upsertInstrumentAliases(instrumentId, input.aliases ?? []);
    return this.db.prepare("SELECT * FROM instruments WHERE id = ?").get(instrumentId) as InstrumentRow;
  }

  private upsertInstrumentAliases(instrumentId: number, aliases: InstrumentAliasInput[]): void {
    if (aliases.length === 0) return;

    const now = new Date().toISOString();
    for (const alias of aliases) {
      const source = normalizeSource(alias.source);
      const sourceSymbol = normalizeSourceSymbol(alias.sourceSymbol);
      const sourceExchange = normalizeExchange(alias.sourceExchange);
      const sourceAssetType = normalizeAssetType(alias.sourceAssetType);
      const sourceId = normalizeNullable(alias.sourceId);
      const rawJson = alias.raw == null ? null : JSON.stringify(alias.raw);
      const existing = sourceId == null
        ? this.db
          .prepare(
            `SELECT id, instrument_id FROM instrument_aliases
             WHERE source = ?
               AND source_symbol = ?
               AND IFNULL(source_exchange, '') = IFNULL(?, '')
               AND IFNULL(source_asset_type, '') = IFNULL(?, '')
             LIMIT 1`,
          )
          .get(source, sourceSymbol, sourceExchange, sourceAssetType) as InstrumentAliasRow | undefined
        : this.db
          .prepare(
            `SELECT id, instrument_id FROM instrument_aliases
             WHERE source = ? AND source_id = ?
             LIMIT 1`,
          )
          .get(source, sourceId) as InstrumentAliasRow | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE instrument_aliases
             SET instrument_id = ?, source_symbol = ?, source_exchange = ?,
                 source_asset_type = ?, source_id = ?, raw_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            instrumentId,
            sourceSymbol,
            sourceExchange,
            sourceAssetType,
            sourceId,
            rawJson,
            now,
            existing.id,
          );
        continue;
      }

      this.db
        .prepare(
          `INSERT INTO instrument_aliases (
             instrument_id, source, source_symbol, source_exchange,
             source_asset_type, source_id, raw_json, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          instrumentId,
          source,
          sourceSymbol,
          sourceExchange,
          sourceAssetType,
          sourceId,
          rawJson,
          now,
          now,
        );
    }
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
    const row = this.getPortfolioLotOrNull(id);
    if (row == null) {
      throw new Error(`portfolio lot ${id} not found`);
    }
    return row;
  }

  private getPortfolioLotOrNull(id: number): PortfolioLotRecord | null {
    const row = this.db
      .prepare(
        `SELECT pl.*, i.symbol, i.name, i.asset_type, i.exchange, i.currency AS instrument_currency
         FROM portfolio_lots pl
         JOIN instruments i ON i.id = pl.instrument_id
         WHERE pl.id = ?`,
      )
      .get(id) as PortfolioLotRow | undefined;
    return row == null ? null : mapPortfolioLot(row);
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

  private getAlertEvent(id: number): AlertEventRecord {
    const row = this.db.prepare("SELECT * FROM alert_events WHERE id = ?").get(id) as AlertEventRow;
    return mapAlertEvent(row);
  }

  private getReportTemplate(id: number): ReportTemplateRecord {
    const row = this.db
      .prepare("SELECT * FROM report_templates WHERE id = ?")
      .get(id) as ReportTemplateRow;
    return mapReportTemplate(row);
  }

  private getReportRun(id: number): ReportRunRecord {
    const row = this.db.prepare("SELECT * FROM report_runs WHERE id = ?").get(id) as ReportRunRow;
    return mapReportRun(row);
  }

  private getImportBatch(id: number): ImportBatchRecord {
    const row = this.db.prepare("SELECT * FROM import_batches WHERE id = ?").get(id) as ImportBatchRow;
    return mapImportBatch(row);
  }

  private getImportRow(id: number): ImportRowRecord {
    const row = this.db.prepare("SELECT * FROM import_rows WHERE id = ?").get(id) as ImportRowRow;
    return mapImportRow(row);
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

function mapInstrument(row: InstrumentRow): InstrumentRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    assetType: row.asset_type,
    name: row.name,
    exchange: row.exchange,
    currency: row.currency,
    provider: row.provider,
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
    source: row.source,
    sourceRowId: row.source_row_id,
    sourceMetadata: row.source_metadata_json == null ? null : JSON.parse(row.source_metadata_json),
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
    source: row.source,
    sourceAccountRef: row.source_account_ref,
    sourceLotId: row.source_lot_id,
    sourceRowId: row.source_row_id,
    sourceMetadata: row.source_metadata_json == null ? null : JSON.parse(row.source_metadata_json),
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

function mapAlertEvent(row: AlertEventRow): AlertEventRecord {
  return {
    id: row.id,
    alertRuleId: row.alert_rule_id,
    instrumentId: row.instrument_id,
    observedValueJson: row.observed_value_json == null ? null : JSON.parse(row.observed_value_json),
    triggeredAt: row.triggered_at,
    status: row.status,
    message: row.message,
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

function mapReportRun(row: ReportRunRow): ReportRunRecord {
  return {
    id: row.id,
    templateId: row.template_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    artifactPath: row.artifact_path,
    summaryJson: row.summary_json == null ? null : JSON.parse(row.summary_json),
    errorsJson: row.errors_json == null ? null : JSON.parse(row.errors_json),
  };
}

function mapImportBatch(row: ImportBatchRow): ImportBatchRecord {
  return {
    id: row.id,
    source: row.source,
    sourceLabel: row.source_label,
    importedAt: row.imported_at,
    status: row.status,
    rawMetadata: row.raw_metadata_json == null ? null : JSON.parse(row.raw_metadata_json),
  };
}

function mapImportRow(row: ImportRowRow): ImportRowRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    rowType: row.row_type,
    sourceSymbol: row.source_symbol,
    sourceRowId: row.source_row_id,
    sourceAccountRef: row.source_account_ref,
    normalizedInstrumentId: row.normalized_instrument_id,
    status: row.status,
    error: row.error,
    sourceMetadata: row.source_metadata_json == null ? null : JSON.parse(row.source_metadata_json),
    raw: row.raw_json == null ? null : JSON.parse(row.raw_json),
  };
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function lastObservedValueFromJson(value: string | null): number | null {
  if (value == null) return null;
  const parsed = JSON.parse(value) as { value?: unknown } | null;
  return typeof parsed?.value === "number" ? parsed.value : null;
}

function normalizeSource(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSourceSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeExchange(value: string | null | undefined): string | null {
  return normalizeNullable(value)?.toUpperCase() ?? null;
}

function normalizeAssetType(value: string | null | undefined): string | null {
  return normalizeNullable(value)?.toLowerCase() ?? null;
}
