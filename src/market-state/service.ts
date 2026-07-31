import type { StateDatabase } from "../runtime/state-database.js";

export type AssetType = "equity" | "etf" | "fund" | "crypto" | "index" | "option" | "unknown";
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
  status: string;
  retriggerMode: string;
  lastConditionState: string;
  ruleRevision: number;
  armCycleId: number;
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
  observedAt: string;
  providerDataAt: string | null;
  sourceProvider: string | null;
  cacheStatus: string;
  dataDelayMs: number | null;
  triggerSource: string;
  dedupeKey: string | null;
  status: string;
  message: string | null;
}

export interface AutomationRunnerLeaseRecord {
  ownerId: string;
  ownerKind: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface AutomationRunnerLeaseResult extends AutomationRunnerLeaseRecord {
  acquired: boolean;
}

export interface AlertCheckRunRecord {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  triggerType: string;
  checkedCount: number;
  triggeredCount: number;
  unavailableCount: number;
  ownerId: string | null;
  errorJson: unknown;
  providerStatusJson: unknown;
}

export interface NotificationEventRecord {
  id: number;
  sourceType: string;
  sourceId: number | null;
  severity: string;
  title: string;
  body: string;
  payloadJson: unknown;
  status: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface NotificationDeliveryAttemptRecord {
  id: number;
  notificationEventId: number;
  channel: string;
  status: string;
  attemptedAt: string;
  completedAt: string | null;
  responseJson: unknown;
  error: string | null;
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
  triggerType: string;
  scheduledFor: string | null;
  ownerId: string | null;
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
  status: string;
  retrigger_mode: string;
  last_condition_state: string;
  rule_revision: number;
  arm_cycle_id: number;
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
  observed_at: string;
  provider_data_at: string | null;
  source_provider: string | null;
  cache_status: string;
  data_delay_ms: number | null;
  trigger_source: string;
  dedupe_key: string | null;
  status: string;
  message: string | null;
};

type AutomationRunnerLeaseRow = {
  owner_id: string;
  owner_kind: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
};

type AlertCheckRunRow = {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  trigger_type: string;
  checked_count: number;
  triggered_count: number;
  unavailable_count: number;
  owner_id: string | null;
  error_json: string | null;
  provider_status_json: string | null;
};

type NotificationEventRow = {
  id: number;
  source_type: string;
  source_id: number | null;
  severity: string;
  title: string;
  body: string;
  payload_json: string | null;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
};

type NotificationDeliveryAttemptRow = {
  id: number;
  notification_event_id: number;
  channel: string;
  status: string;
  attempted_at: string;
  completed_at: string | null;
  response_json: string | null;
  error: string | null;
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
  trigger_type: string;
  scheduled_for: string | null;
  owner_id: string | null;
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
  constructor(private readonly db: StateDatabase) {}

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

  listWatchlists(): CollectionRecord[] {
    this.getDefaultWatchlist();
    const rows = this.db
      .prepare("SELECT * FROM watchlists ORDER BY is_default DESC, name COLLATE NOCASE")
      .all() as WatchlistRow[];
    return rows.map(mapCollection);
  }

  createWatchlist(name: string): CollectionRecord {
    const normalized = normalizeCollectionName(name);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO watchlists (name, is_default, created_at, updated_at)
         VALUES (?, 0, ?, ?)`,
      )
      .run(normalized, now, now);
    const row = this.db
      .prepare("SELECT * FROM watchlists WHERE name = ? LIMIT 1")
      .get(normalized) as WatchlistRow;
    return mapCollection(row);
  }

  getWatchlistByName(name: string): CollectionRecord | null {
    const normalized = normalizeCollectionName(name);
    const row = this.db
      .prepare("SELECT * FROM watchlists WHERE name = ? LIMIT 1")
      .get(normalized) as WatchlistRow | undefined;
    return row == null ? null : mapCollection(row);
  }

  renameWatchlist(currentName: string, nextName: string): CollectionRecord {
    const current = this.getWatchlistByName(currentName);
    if (current == null) throw new Error(`watchlist ${currentName.trim()} not found.`);
    const normalizedNext = normalizeCollectionName(nextName);
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE watchlists SET name = ?, updated_at = ? WHERE id = ?")
      .run(normalizedNext, now, current.id);
    const row = this.db.prepare("SELECT * FROM watchlists WHERE id = ? LIMIT 1").get(current.id) as
      | WatchlistRow
      | undefined;
    if (row == null) throw new Error("renamed watchlist could not be loaded.");
    return mapCollection(row);
  }

  deleteWatchlist(name: string): CollectionRecord {
    const watchlists = this.listWatchlists();
    const current = this.getWatchlistByName(name);
    if (current == null) throw new Error(`watchlist ${name.trim()} not found.`);
    if (watchlists.length <= 1) throw new Error("cannot delete the last remaining watchlist.");

    const selected = watchlists.find((watchlist) => watchlist.id !== current.id);
    if (selected == null) throw new Error("replacement watchlist could not be selected.");

    const selectAndDelete = this.db.transaction(() => {
      if (current.isDefault) {
        this.db.prepare("UPDATE watchlists SET is_default = 0 WHERE id = ?").run(current.id);
        this.db.prepare("UPDATE watchlists SET is_default = 1 WHERE id = ?").run(selected.id);
      }
      this.db.prepare("DELETE FROM watchlists WHERE id = ?").run(current.id);
    });
    selectAndDelete();

    const row = this.db.prepare("SELECT * FROM watchlists WHERE id = ? LIMIT 1").get(selected.id) as
      | WatchlistRow
      | undefined;
    if (row == null) throw new Error("replacement watchlist could not be loaded.");
    return mapCollection(row);
  }

  getOrCreateWatchlist(name?: string | null): CollectionRecord {
    const normalized = normalizeNullable(name);
    if (normalized == null) return this.getDefaultWatchlist();
    return this.getWatchlistByName(normalized) ?? this.createWatchlist(normalized);
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

  listPortfolios(): CollectionRecord[] {
    this.getDefaultPortfolio();
    const rows = this.db
      .prepare("SELECT * FROM portfolios ORDER BY is_default DESC, name COLLATE NOCASE")
      .all() as PortfolioRow[];
    return rows.map((row) => ({ ...mapCollection(row), baseCurrency: row.base_currency }));
  }

  createPortfolio(name: string, baseCurrency = "USD"): CollectionRecord {
    const normalized = normalizeCollectionName(name);
    const existing = this.getPortfolioByName(normalized);
    if (existing != null) return existing;
    const normalizedCurrency = baseCurrency.trim().toUpperCase() || "USD";
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO portfolios (name, base_currency, is_default, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)`,
      )
      .run(normalized, normalizedCurrency, now, now);
    const row = this.db
      .prepare("SELECT * FROM portfolios WHERE name = ? LIMIT 1")
      .get(normalized) as PortfolioRow;
    return { ...mapCollection(row), baseCurrency: row.base_currency };
  }

  getPortfolioByName(name: string): CollectionRecord | null {
    const normalized = normalizeCollectionName(name);
    const row = this.db
      .prepare("SELECT * FROM portfolios WHERE name = ? LIMIT 1")
      .get(normalized) as PortfolioRow | undefined;
    return row == null ? null : { ...mapCollection(row), baseCurrency: row.base_currency };
  }

  renamePortfolio(currentName: string, nextName: string): CollectionRecord {
    const current = this.getPortfolioByName(currentName);
    if (current == null) throw new Error(`portfolio ${currentName.trim()} not found.`);
    const normalizedNext = normalizeCollectionName(nextName);
    const existing = this.getPortfolioByName(normalizedNext);
    if (existing != null && existing.id !== current.id) {
      throw new Error(`portfolio ${normalizedNext} already exists.`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE portfolios SET name = ?, updated_at = ? WHERE id = ?")
      .run(normalizedNext, now, current.id);
    const row = this.db.prepare("SELECT * FROM portfolios WHERE id = ? LIMIT 1").get(current.id) as
      | PortfolioRow
      | undefined;
    if (row == null) throw new Error("renamed portfolio could not be loaded.");
    return { ...mapCollection(row), baseCurrency: row.base_currency };
  }

  getOrCreatePortfolio(name?: string | null): CollectionRecord {
    const normalized = normalizeNullable(name);
    if (normalized == null) return this.getDefaultPortfolio();
    return this.getPortfolioByName(normalized) ?? this.createPortfolio(normalized);
  }

  findInstrumentByAlias(lookup: InstrumentAliasLookup): InstrumentRecord | null {
    const source = normalizeSource(lookup.source);
    const sourceId = normalizeNullable(lookup.sourceId);
    const alias =
      sourceId == null
        ? (this.db
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
            ) as InstrumentAliasRow | undefined)
        : (this.db
            .prepare(
              `SELECT id, instrument_id FROM instrument_aliases
           WHERE source = ? AND source_id = ?
           LIMIT 1`,
            )
            .get(source, sourceId) as InstrumentAliasRow | undefined);

    if (alias == null) return null;

    const row = this.db
      .prepare("SELECT * FROM instruments WHERE id = ?")
      .get(alias.instrument_id) as InstrumentRow | undefined;
    return row == null ? null : mapInstrument(row);
  }

  addWatchlistItem(params: {
    instrument: InstrumentInput;
    watchlistId?: number;
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
             SET source = ?, source_row_id = ?, source_metadata_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            params.source === undefined ? existing.source : normalizeNullable(params.source),
            params.sourceRowId === undefined
              ? existing.source_row_id
              : normalizeNullable(params.sourceRowId),
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
             watchlist_id, instrument_id, source, source_row_id, source_metadata_json,
             created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          watchlistId,
          instrument.id,
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

  removeWatchlistItemBySymbol(
    symbol: string,
    watchlistId = this.getDefaultWatchlist().id,
  ): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM watchlist_items
         WHERE watchlist_id = ?
           AND instrument_id IN (SELECT id FROM instruments WHERE symbol = ?)`,
      )
      .run(watchlistId, symbol.trim().toUpperCase());
    return result.changes > 0;
  }

  removeWatchlistItem(itemId: number, watchlistId = this.getDefaultWatchlist().id): boolean {
    const result = this.db
      .prepare("DELETE FROM watchlist_items WHERE id = ? AND watchlist_id = ?")
      .run(itemId, watchlistId);
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
    source?: string;
    sourceAccountRef?: string;
    sourceLotId?: string;
    sourceRowId?: string;
    sourceMetadata?: unknown;
  }): PortfolioLotRecord {
    assertPositiveFinitePortfolioLotNumber(params.quantity, "quantity");
    assertPositiveFinitePortfolioLotNumber(params.avgCost, "average cost");
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

  removePortfolioLotsBySymbol(
    symbol: string,
    portfolioId = this.getDefaultPortfolio().id,
  ): boolean {
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
    if (params.quantity != null) {
      assertPositiveFinitePortfolioLotNumber(params.quantity, "quantity");
    }
    if (params.avgCost != null) {
      assertPositiveFinitePortfolioLotNumber(params.avgCost, "average cost");
    }
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
    retriggerMode?: string;
  }): AlertRuleRecord {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO alert_rules (
           scope_type, scope_id, instrument_id, condition_type, condition_version,
           condition_json, timeframe, enabled, check_interval_seconds, next_check_at,
           retrigger_mode, cooldown_seconds, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        params.retriggerMode ?? "recurring",
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

  setAlertRuleEnabled(id: number, enabled: boolean): AlertRuleRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE alert_rules
         SET enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, now, id);
    if (result.changes === 0) return null;
    return this.getAlertRule(id);
  }

  updateAlertRule(
    id: number,
    params: {
      scopeType?: AlertScopeType;
      scopeId?: number | null;
      instrumentId?: number | null;
      conditionType?: string;
      conditionVersion?: number;
      condition?: unknown;
      timeframe?: string;
      enabled?: boolean;
      checkIntervalSeconds?: number | null;
      nextCheckAt?: string | null;
      cooldownSeconds?: number | null;
      retriggerMode?: string;
    },
  ): AlertRuleRecord | null {
    const existing = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as
      | AlertRuleRow
      | undefined;
    if (existing == null) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE alert_rules
         SET scope_type = ?,
             scope_id = ?,
             instrument_id = ?,
             condition_type = ?,
             condition_version = ?,
             condition_json = ?,
             timeframe = ?,
             enabled = ?,
             check_interval_seconds = ?,
             next_check_at = ?,
             last_checked_at = NULL,
             last_observed_json = NULL,
             status = 'active',
             retrigger_mode = ?,
             last_condition_state = 'unknown',
             rule_revision = rule_revision + 1,
             arm_cycle_id = arm_cycle_id + 1,
             cooldown_seconds = ?,
             last_triggered_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        params.scopeType ?? existing.scope_type,
        params.scopeId === undefined ? existing.scope_id : params.scopeId,
        params.instrumentId === undefined ? existing.instrument_id : params.instrumentId,
        params.conditionType ?? existing.condition_type,
        params.conditionVersion ?? existing.condition_version,
        JSON.stringify(
          params.condition === undefined ? JSON.parse(existing.condition_json) : params.condition,
        ),
        params.timeframe ?? existing.timeframe,
        params.enabled === undefined ? existing.enabled : params.enabled ? 1 : 0,
        params.checkIntervalSeconds === undefined
          ? existing.check_interval_seconds
          : params.checkIntervalSeconds,
        params.nextCheckAt === undefined ? existing.next_check_at : params.nextCheckAt,
        params.retriggerMode ?? existing.retrigger_mode,
        params.cooldownSeconds === undefined ? existing.cooldown_seconds : params.cooldownSeconds,
        now,
        id,
      );
    return this.getAlertRule(id);
  }

  deleteAlertRule(id: number): AlertRuleRecord | null {
    const existing = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as
      | AlertRuleRow
      | undefined;
    if (existing == null) return null;
    this.db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
    return mapAlertRule(existing);
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

  acquireAutomationRunnerLease(params: {
    ownerId: string;
    ownerKind: string;
    now?: string;
    ttlSeconds: number;
  }): AutomationRunnerLeaseResult {
    const now = params.now ?? new Date().toISOString();
    const nowMs = new Date(now).getTime();
    const expiresAt = new Date(nowMs + params.ttlSeconds * 1000).toISOString();
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          "SELECT owner_id, owner_kind, acquired_at, heartbeat_at, expires_at FROM automation_runner_leases WHERE id = 1",
        )
        .get() as AutomationRunnerLeaseRow | undefined;

      if (
        current != null &&
        current.owner_id !== params.ownerId &&
        new Date(current.expires_at).getTime() > nowMs
      ) {
        return { acquired: false, ...mapAutomationRunnerLease(current) };
      }

      this.db
        .prepare(
          `INSERT INTO automation_runner_leases (
             id, owner_id, owner_kind, acquired_at, heartbeat_at, expires_at
           )
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             owner_id = excluded.owner_id,
             owner_kind = excluded.owner_kind,
             acquired_at = excluded.acquired_at,
             heartbeat_at = excluded.heartbeat_at,
             expires_at = excluded.expires_at`,
        )
        .run(params.ownerId, params.ownerKind, now, now, expiresAt);

      return {
        acquired: true,
        ownerId: params.ownerId,
        ownerKind: params.ownerKind,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt,
      };
    });
    return tx();
  }

  getAutomationRunnerLease(now = new Date().toISOString()): AutomationRunnerLeaseRecord | null {
    const row = this.db
      .prepare(
        "SELECT owner_id, owner_kind, acquired_at, heartbeat_at, expires_at FROM automation_runner_leases WHERE id = 1",
      )
      .get() as AutomationRunnerLeaseRow | undefined;
    if (row == null) return null;
    if (new Date(row.expires_at).getTime() <= new Date(now).getTime()) return null;
    return mapAutomationRunnerLease(row);
  }

  releaseAutomationRunnerLease(ownerId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM automation_runner_leases WHERE id = 1 AND owner_id = ?")
      .run(ownerId);
    return result.changes > 0;
  }

  startAlertCheckRun(params: {
    ownerId?: string | null;
    startedAt?: string;
    triggerType: string;
  }): AlertCheckRunRecord {
    const startedAt = params.startedAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO alert_check_runs (
           started_at, status, trigger_type, owner_id
         )
         VALUES (?, 'running', ?, ?)`,
      )
      .run(startedAt, params.triggerType, params.ownerId ?? null);
    return this.getAlertCheckRun(Number(result.lastInsertRowid));
  }

  completeAlertCheckRun(
    id: number,
    params: {
      completedAt?: string;
      status: string;
      checkedCount: number;
      triggeredCount: number;
      unavailableCount: number;
      error?: unknown;
      providerStatus?: unknown;
    },
  ): AlertCheckRunRecord {
    const completedAt = params.completedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE alert_check_runs
         SET completed_at = ?,
             status = ?,
             checked_count = ?,
             triggered_count = ?,
             unavailable_count = ?,
             error_json = ?,
             provider_status_json = ?
         WHERE id = ?`,
      )
      .run(
        completedAt,
        params.status,
        params.checkedCount,
        params.triggeredCount,
        params.unavailableCount,
        params.error == null ? null : JSON.stringify(params.error),
        params.providerStatus == null ? null : JSON.stringify(params.providerStatus),
        id,
      );
    return this.getAlertCheckRun(id);
  }

  getAlertCheckRun(id: number): AlertCheckRunRecord {
    const row = this.db.prepare("SELECT * FROM alert_check_runs WHERE id = ?").get(id) as
      | AlertCheckRunRow
      | undefined;
    if (row == null) throw new Error(`alert check run ${id} not found`);
    return mapAlertCheckRun(row);
  }

  listAlertCheckRuns(): AlertCheckRunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM alert_check_runs ORDER BY started_at DESC, id DESC")
      .all() as AlertCheckRunRow[];
    return rows.map(mapAlertCheckRun);
  }

  markStaleAutomationRunsLost(params: { now?: string; graceSeconds: number }): {
    alertCheckRuns: number;
    reportRuns: number;
  } {
    const now = params.now ?? new Date().toISOString();
    const cutoff = new Date(new Date(now).getTime() - params.graceSeconds * 1000).toISOString();
    const tx = this.db.transaction(() => {
      const alertResult = this.db
        .prepare(
          `UPDATE alert_check_runs
           SET status = 'lost',
               completed_at = COALESCE(completed_at, ?),
               error_json = COALESCE(error_json, ?)
           WHERE status = 'running' AND started_at < ?`,
        )
        .run(now, JSON.stringify({ message: "runner lease expired before completion" }), cutoff);
      const reportResult = this.db
        .prepare(
          `UPDATE report_runs
           SET status = 'lost',
               completed_at = COALESCE(completed_at, ?),
               errors_json = COALESCE(errors_json, ?)
           WHERE status = 'running' AND started_at < ?`,
        )
        .run(now, JSON.stringify(["runner lease expired before completion"]), cutoff);
      return {
        alertCheckRuns: alertResult.changes,
        reportRuns: reportResult.changes,
      };
    });
    return tx();
  }

  recordNotificationEvent(params: {
    sourceType: string;
    sourceId?: number | null;
    severity: string;
    title: string;
    body: string;
    payload?: unknown;
    status?: string;
    createdAt?: string;
  }): NotificationEventRecord {
    const createdAt = params.createdAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO notification_events (
           source_type, source_id, severity, title, body, payload_json, status, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.sourceType,
        params.sourceId ?? null,
        params.severity,
        params.title,
        params.body,
        params.payload == null ? null : JSON.stringify(params.payload),
        params.status ?? "unread",
        createdAt,
      );
    return this.getNotificationEvent(Number(result.lastInsertRowid));
  }

  listNotificationEvents(): NotificationEventRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM notification_events ORDER BY created_at DESC, id DESC")
      .all() as NotificationEventRow[];
    return rows.map(mapNotificationEvent);
  }

  getNotificationEvent(id: number): NotificationEventRecord {
    const row = this.db.prepare("SELECT * FROM notification_events WHERE id = ?").get(id) as
      | NotificationEventRow
      | undefined;
    if (row == null) throw new Error(`notification event ${id} not found`);
    return mapNotificationEvent(row);
  }

  acknowledgeNotificationEvent(
    id: number,
    acknowledgedAt = new Date().toISOString(),
  ): NotificationEventRecord {
    this.db
      .prepare(
        `UPDATE notification_events
         SET status = 'acknowledged',
             acknowledged_at = ?
         WHERE id = ?`,
      )
      .run(acknowledgedAt, id);
    return this.getNotificationEvent(id);
  }

  recordNotificationDeliveryAttempt(params: {
    notificationEventId: number;
    channel: string;
    status: string;
    attemptedAt?: string;
    completedAt?: string | null;
    response?: unknown;
    error?: string | null;
  }): NotificationDeliveryAttemptRecord {
    const attemptedAt = params.attemptedAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO notification_delivery_attempts (
           notification_event_id, channel, status, attempted_at, completed_at,
           response_json, error
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.notificationEventId,
        params.channel,
        params.status,
        attemptedAt,
        params.completedAt ?? null,
        params.response == null ? null : JSON.stringify(params.response),
        params.error ?? null,
      );
    return this.getNotificationDeliveryAttempt(Number(result.lastInsertRowid));
  }

  listNotificationDeliveryAttempts(
    notificationEventId?: number,
  ): NotificationDeliveryAttemptRecord[] {
    const rows =
      notificationEventId == null
        ? this.db
            .prepare(
              "SELECT * FROM notification_delivery_attempts ORDER BY attempted_at DESC, id DESC",
            )
            .all()
        : this.db
            .prepare(
              "SELECT * FROM notification_delivery_attempts WHERE notification_event_id = ? ORDER BY attempted_at DESC, id DESC",
            )
            .all(notificationEventId);
    return (rows as NotificationDeliveryAttemptRow[]).map(mapNotificationDeliveryAttempt);
  }

  getNotificationDeliveryAttempt(id: number): NotificationDeliveryAttemptRecord {
    const row = this.db
      .prepare("SELECT * FROM notification_delivery_attempts WHERE id = ?")
      .get(id) as NotificationDeliveryAttemptRow | undefined;
    if (row == null) throw new Error(`notification delivery attempt ${id} not found`);
    return mapNotificationDeliveryAttempt(row);
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
      const canTrigger =
        params.trigger != null &&
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

  recordAlertEvaluationResult(params: {
    ruleId: number;
    observed: unknown;
    checkedAt: string;
    conditionState: "true" | "false" | "unknown";
    trigger?: {
      instrumentId: number | null;
      title?: string;
      message: string;
      triggeredAt: string;
      observedAt: string;
      providerDataAt?: string | null;
      sourceProvider?: string | null;
      cacheStatus?: string;
      dataDelayMs?: number | null;
      triggerSource: string;
      dedupeKey: string;
      status?: string;
    };
  }): { triggered: boolean; event: AlertEventRecord | null; rule: AlertRuleRecord } {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(params.ruleId) as
        | AlertRuleRow
        | undefined;
      if (row == null) {
        throw new Error(`alert rule ${params.ruleId} not found`);
      }

      const rearmed = params.conditionState === "false" && row.last_condition_state === "true";
      const nextArmCycleId = rearmed ? row.arm_cycle_id + 1 : row.arm_cycle_id;
      let eventId: number | null = null;
      const canInsertTrigger =
        params.trigger != null &&
        row.enabled === 1 &&
        row.status === "active" &&
        row.last_condition_state !== "true";

      if (params.trigger != null && canInsertTrigger) {
        const result = this.db
          .prepare(
            `INSERT OR IGNORE INTO alert_events (
               alert_rule_id, instrument_id, observed_value_json, triggered_at,
               observed_at, provider_data_at, source_provider, cache_status,
               data_delay_ms, trigger_source, dedupe_key, status, message
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.ruleId,
            params.trigger.instrumentId,
            JSON.stringify(params.observed),
            params.trigger.triggeredAt,
            params.trigger.observedAt,
            params.trigger.providerDataAt ?? null,
            params.trigger.sourceProvider ?? null,
            params.trigger.cacheStatus ?? "live",
            params.trigger.dataDelayMs ?? null,
            params.trigger.triggerSource,
            params.trigger.dedupeKey,
            params.trigger.status ?? "triggered",
            params.trigger.message,
          );

        if (result.changes > 0) {
          eventId = Number(result.lastInsertRowid);
          this.db
            .prepare(
              `INSERT INTO notification_events (
                 source_type, source_id, severity, title, body, payload_json, status, created_at
               )
               VALUES ('alert_event', ?, 'warning', ?, ?, ?, 'unread', ?)`,
            )
            .run(
              eventId,
              params.trigger.title ?? "Alert triggered",
              params.trigger.message,
              JSON.stringify({
                ruleId: params.ruleId,
                observed: params.observed,
                sourceProvider: params.trigger.sourceProvider ?? null,
                providerDataAt: params.trigger.providerDataAt ?? null,
                cacheStatus: params.trigger.cacheStatus ?? "live",
                dataDelayMs: params.trigger.dataDelayMs ?? null,
              }),
              params.trigger.observedAt,
            );
        }
      }

      const triggered = eventId != null;
      const completeOneShot = triggered && row.retrigger_mode === "once";
      this.db
        .prepare(
          `UPDATE alert_rules
           SET last_checked_at = ?,
               last_observed_json = ?,
               last_condition_state = ?,
               arm_cycle_id = ?,
               next_check_at = ?,
               last_triggered_at = COALESCE(?, last_triggered_at),
               enabled = CASE WHEN ? THEN 0 ELSE enabled END,
               status = CASE WHEN ? THEN 'completed' ELSE status END,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          params.checkedAt,
          JSON.stringify(params.observed),
          params.conditionState,
          nextArmCycleId,
          nextAlertCheckAt(row, params.checkedAt),
          triggered && params.trigger ? params.trigger.triggeredAt : null,
          completeOneShot ? 1 : 0,
          completeOneShot ? 1 : 0,
          params.checkedAt,
          params.ruleId,
        );

      return { triggered, eventId };
    });
    const result = tx();
    return {
      triggered: result.triggered,
      event: result.eventId == null ? null : this.getAlertEvent(result.eventId),
      rule: this.getAlertRule(params.ruleId),
    };
  }

  recordAlertUnavailable(params: {
    ruleId: number;
    instrumentId?: number | null;
    reason: string;
    checkedAt: string;
  }): { event: AlertEventRecord; rule: AlertRuleRecord } {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(params.ruleId) as
        | AlertRuleRow
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
               next_check_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          params.checkedAt,
          nextAlertCheckAt(row, params.checkedAt),
          params.checkedAt,
          params.ruleId,
        );

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

  updateReportTemplate(
    id: number,
    params: {
      name?: string;
      reportType?: string;
      cadence?: string;
      timezone?: string;
      localTime?: string;
      config?: unknown;
      enabled?: boolean;
      nextRunAt?: string | null;
    },
  ): ReportTemplateRecord {
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

  claimDueReportTemplateRun(
    id: number,
    params: {
      scheduledFor: string;
      nextRunAt: string;
      claimedAt?: string;
    },
  ): ReportTemplateRecord | null {
    const result = this.db
      .prepare(
        `UPDATE report_templates
         SET next_run_at = ?, updated_at = ?
         WHERE id = ? AND enabled = 1 AND next_run_at = ?`,
      )
      .run(params.nextRunAt, params.claimedAt ?? new Date().toISOString(), id, params.scheduledFor);
    return result.changes === 0 ? null : this.getReportTemplate(id);
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
    triggerType?: string;
    scheduledFor?: string | null;
    ownerId?: string | null;
    artifactPath?: string | null;
    summary?: unknown;
    errors?: unknown;
  }): ReportRunRecord {
    const startedAt = params.startedAt ?? new Date().toISOString();
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO report_runs (
             template_id, started_at, completed_at, status, trigger_type, scheduled_for,
             owner_id, artifact_path, summary_json, errors_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.templateId ?? null,
          startedAt,
          params.completedAt ?? null,
          params.status,
          params.triggerType ?? "manual",
          params.scheduledFor ?? null,
          params.ownerId ?? null,
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
      return this.db
        .prepare("SELECT * FROM instruments WHERE id = ?")
        .get(existing.id) as InstrumentRow;
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
    return this.db
      .prepare("SELECT * FROM instruments WHERE id = ?")
      .get(instrumentId) as InstrumentRow;
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
      const existing =
        sourceId == null
          ? (this.db
              .prepare(
                `SELECT id, instrument_id FROM instrument_aliases
             WHERE source = ?
               AND source_symbol = ?
               AND IFNULL(source_exchange, '') = IFNULL(?, '')
               AND IFNULL(source_asset_type, '') = IFNULL(?, '')
             LIMIT 1`,
              )
              .get(source, sourceSymbol, sourceExchange, sourceAssetType) as
              | InstrumentAliasRow
              | undefined)
          : (this.db
              .prepare(
                `SELECT id, instrument_id FROM instrument_aliases
             WHERE source = ? AND source_id = ?
             LIMIT 1`,
              )
              .get(source, sourceId) as InstrumentAliasRow | undefined);

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

  getAlertRule(id: number): AlertRuleRecord {
    const row = this.db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRuleRow;
    return mapAlertRule(row);
  }

  getAlertEvent(id: number): AlertEventRecord {
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
    const row = this.db
      .prepare("SELECT * FROM import_batches WHERE id = ?")
      .get(id) as ImportBatchRow;
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
    source: row.source,
    sourceRowId: row.source_row_id,
    sourceMetadata: row.source_metadata_json == null ? null : JSON.parse(row.source_metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCollectionName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("watchlist name is required.");
  return normalized;
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
    status: row.status,
    retriggerMode: row.retrigger_mode,
    lastConditionState: row.last_condition_state,
    ruleRevision: row.rule_revision,
    armCycleId: row.arm_cycle_id,
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
    observedAt: row.observed_at,
    providerDataAt: row.provider_data_at,
    sourceProvider: row.source_provider,
    cacheStatus: row.cache_status,
    dataDelayMs: row.data_delay_ms,
    triggerSource: row.trigger_source,
    dedupeKey: row.dedupe_key,
    status: row.status,
    message: row.message,
  };
}

function mapAutomationRunnerLease(row: AutomationRunnerLeaseRow): AutomationRunnerLeaseRecord {
  return {
    ownerId: row.owner_id,
    ownerKind: row.owner_kind,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
  };
}

function mapAlertCheckRun(row: AlertCheckRunRow): AlertCheckRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    triggerType: row.trigger_type,
    checkedCount: row.checked_count,
    triggeredCount: row.triggered_count,
    unavailableCount: row.unavailable_count,
    ownerId: row.owner_id,
    errorJson: row.error_json == null ? null : JSON.parse(row.error_json),
    providerStatusJson:
      row.provider_status_json == null ? null : JSON.parse(row.provider_status_json),
  };
}

function mapNotificationEvent(row: NotificationEventRow): NotificationEventRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    payloadJson: row.payload_json == null ? null : JSON.parse(row.payload_json),
    status: row.status,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

function mapNotificationDeliveryAttempt(
  row: NotificationDeliveryAttemptRow,
): NotificationDeliveryAttemptRecord {
  return {
    id: row.id,
    notificationEventId: row.notification_event_id,
    channel: row.channel,
    status: row.status,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at,
    responseJson: row.response_json == null ? null : JSON.parse(row.response_json),
    error: row.error,
  };
}

function nextAlertCheckAt(row: AlertRuleRow, checkedAt: string): string | null {
  if (row.check_interval_seconds == null) return null;
  const checkedAtMs = new Date(checkedAt).getTime();
  if (!Number.isFinite(checkedAtMs)) return null;
  return new Date(checkedAtMs + row.check_interval_seconds * 1000).toISOString();
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
    triggerType: row.trigger_type,
    scheduledFor: row.scheduled_for,
    ownerId: row.owner_id,
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

function assertPositiveFinitePortfolioLotNumber(
  value: number,
  label: "quantity" | "average cost",
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Portfolio lot ${label} must be a positive finite number.`);
  }
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
