import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SentimentSource, SentinelRecord, TrendBucket } from "./types.js";

const SCHEMA_VERSION = 1;

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sentinel_records (
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    query TEXT NOT NULL,
    title TEXT,
    text TEXT NOT NULL,
    author TEXT,
    url TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    engagement_json TEXT NOT NULL,
    sentiment_score REAL NOT NULL,
    sentiment_confidence REAL NOT NULL,
    sentiment_method TEXT NOT NULL,
    tickers_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    UNIQUE(source, source_id, fetched_at)
  );

  CREATE INDEX IF NOT EXISTS idx_sentinel_source ON sentinel_records(source);
  CREATE INDEX IF NOT EXISTS idx_sentinel_fetched_at ON sentinel_records(fetched_at);
  CREATE INDEX IF NOT EXISTS idx_sentinel_query ON sentinel_records(query);

  CREATE VIRTUAL TABLE IF NOT EXISTS sentinel_fts USING fts5(
    text, title, author, query, source,
    content=sentinel_records,
    content_rowid=rowid
  );
`;

const TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS sentinel_ai AFTER INSERT ON sentinel_records BEGIN
    INSERT INTO sentinel_fts(rowid, text, title, author, query, source)
    VALUES (new.rowid, new.text, new.title, new.author, new.query, new.source);
  END;

  CREATE TRIGGER IF NOT EXISTS sentinel_ad AFTER DELETE ON sentinel_records BEGIN
    INSERT INTO sentinel_fts(sentinel_fts, rowid, text, title, author, query, source)
    VALUES ('delete', old.rowid, old.text, old.title, old.author, old.query, old.source);
  END;
`;

export interface SearchOptions {
  source?: SentimentSource;
  since?: string;
  until?: string;
}

export interface TimeSeriesOptions {
  days: number;
  bucketHours: number;
}

export class SentimentStore {
  private db: Database.Database;

  constructor(pathOrMemory: string) {
    if (pathOrMemory !== ":memory:") {
      mkdirSync(dirname(pathOrMemory), { recursive: true });
    }
    this.db = new Database(pathOrMemory);
    if (pathOrMemory !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(CREATE_SCHEMA);
    this.db.exec(TRIGGERS);

    const row = this.db.prepare("SELECT version FROM schema_version").get() as
      | { version: number }
      | undefined;
    if (!row) {
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    }
  }

  getSchemaVersion(): number {
    const row = this.db.prepare("SELECT version FROM schema_version").get() as { version: number };
    return row.version;
  }

  insert(records: SentinelRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO sentinel_records
        (id, source, source_id, query, title, text, author, url,
         published_at, fetched_at, engagement_json,
         sentiment_score, sentiment_confidence, sentiment_method,
         tickers_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((recs: SentinelRecord[]) => {
      for (const r of recs) {
        stmt.run(
          r.id,
          r.source,
          r.sourceId,
          r.query,
          r.title,
          r.text,
          r.author,
          r.url,
          r.publishedAt,
          r.fetchedAt,
          JSON.stringify(r.engagement),
          r.sentiment.score,
          r.sentiment.confidence,
          r.sentiment.method,
          JSON.stringify(r.sentiment.tickers),
          JSON.stringify(r.metadata),
        );
      }
    });

    tx(records);
  }

  search(query: string, options?: SearchOptions): SentinelRecord[] {
    let sql = `
      SELECT sr.* FROM sentinel_records sr
      JOIN sentinel_fts fts ON sr.rowid = fts.rowid
      WHERE sentinel_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (options?.source) {
      sql += " AND sr.source = ?";
      params.push(options.source);
    }
    if (options?.since) {
      sql += " AND sr.fetched_at >= ?";
      params.push(options.since);
    }
    if (options?.until) {
      sql += " AND sr.fetched_at <= ?";
      params.push(options.until);
    }

    sql += " ORDER BY bm25(sentinel_fts) LIMIT 100";

    const rows = this.db.prepare(sql).all(...params) as RawRow[];
    return rows.map(rowToRecord);
  }

  getByTicker(ticker: string, options?: { since?: string }): SentinelRecord[] {
    let sql = `SELECT * FROM sentinel_records WHERE tickers_json LIKE ?`;
    const pattern = `%"${ticker}"%`;
    const params: unknown[] = [pattern];

    if (options?.since) {
      sql += " AND fetched_at >= ?";
      params.push(options.since);
    }

    sql += " ORDER BY fetched_at DESC LIMIT 100";
    const rows = this.db.prepare(sql).all(...params) as RawRow[];
    return rows.map(rowToRecord);
  }

  getTimeSeries(query: string, options: TimeSeriesOptions): TrendBucket[] {
    const since = new Date();
    since.setDate(since.getDate() - options.days);
    const sinceStr = since.toISOString();
    const bucketSeconds = options.bucketHours * 3600;

    const sql = `
      SELECT
        (CAST(strftime('%s', fetched_at) AS INTEGER) / ?) * ? AS bucket_ts,
        AVG(sentiment_score) AS avg_score,
        COUNT(*) AS cnt
      FROM sentinel_records
      WHERE query = ? AND fetched_at >= ?
      GROUP BY bucket_ts
      ORDER BY bucket_ts
    `;

    const rows = this.db.prepare(sql).all(bucketSeconds, bucketSeconds, query, sinceStr) as Array<{
      bucket_ts: number;
      avg_score: number;
      cnt: number;
    }>;

    return rows.map((r) => ({
      timestamp: new Date(r.bucket_ts * 1000).toISOString(),
      avgScore: r.avg_score,
      count: r.cnt,
    }));
  }

  prune(retentionDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = this.db
      .prepare("DELETE FROM sentinel_records WHERE fetched_at < ?")
      .run(cutoff.toISOString());
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

interface RawRow {
  id: string;
  source: string;
  source_id: string;
  query: string;
  title: string | null;
  text: string;
  author: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string;
  engagement_json: string;
  sentiment_score: number;
  sentiment_confidence: number;
  sentiment_method: string;
  tickers_json: string;
  metadata_json: string;
}

function rowToRecord(row: RawRow): SentinelRecord {
  return {
    id: row.id,
    source: row.source as SentinelRecord["source"],
    sourceId: row.source_id,
    query: row.query,
    title: row.title,
    text: row.text,
    author: row.author,
    url: row.url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    engagement: JSON.parse(row.engagement_json),
    sentiment: {
      score: row.sentiment_score,
      confidence: row.sentiment_confidence,
      method: row.sentiment_method as "keyword",
      tickers: JSON.parse(row.tickers_json),
    },
    metadata: JSON.parse(row.metadata_json),
  };
}
