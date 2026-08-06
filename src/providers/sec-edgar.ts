import { cache, TTL } from "../infra/cache.js";
import { httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";

const EFTS_BASE = "https://efts.sec.gov/LATEST/search-index";
const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const SEC_DOCUMENT_FETCH_TIMEOUT_MS = 10_000;

export interface SECFiling {
  formType: string;
  filedDate: string;
  periodOfReport: string;
  entityName: string;
  accessionNumber: string;
  url: string;
  primaryDocumentUrl?: string;
  items?: string[];
  evidenceSnippets?: string[];
  evidenceWarning?: string;
}

export interface SearchFilingsOptions {
  includeSnippets?: boolean;
  snippetLimitPerFiling?: number;
}

interface EFTSResponse {
  hits: {
    hits: Array<{
      _id: string;
      _source: {
        file_date: string;
        form: string;
        adsh: string;
        display_names: string[];
        period_ending: string;
        ciks: string[];
        items?: string[];
      };
    }>;
  };
}

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SubmissionsResponse {
  name: string;
  tickers?: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      items?: string[];
    };
  };
}

export async function searchFilings(
  ticker: string,
  formTypes: string[] = ["10-K", "10-Q", "8-K"],
  limit: number = 10,
  options: SearchFilingsOptions = {},
): Promise<SECFiling[]> {
  const cacheKey = `sec:${ticker}:${formTypes.join(",")}:${limit}:${options.includeSnippets ? "snippets" : "metadata"}`;
  const cached = cache.get<SECFiling[]>(cacheKey);
  if (cached) return cached;

  if (options.includeSnippets) {
    const submissions = await searchFilingsFromCompanySubmissions(ticker, formTypes, limit).catch(
      () => [],
    );
    if (submissions.length > 0) {
      await enrichWithEvidenceSnippets(submissions, options.snippetLimitPerFiling ?? 3);
      cache.set(cacheKey, submissions, TTL.FUNDAMENTALS);
      return submissions;
    }
  }

  const params = new URLSearchParams({
    q: ticker,
    forms: formTypes.join(","),
    dateRange: "custom",
    startdt: getDateYearsAgo(3),
    enddt: new Date().toISOString().split("T")[0],
    from: "0",
    size: String(limit),
  });

  const url = `${EFTS_BASE}?${params}`;
  const data = await httpGet<EFTSResponse>(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OpenCandle/1.0 (financial analysis agent)",
    },
  });

  // Deduplicate by accession number (EDGAR returns multiple hits per filing)
  const seen = new Set<string>();
  const filings: SECFiling[] = [];

  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source;
    const accession = src.adsh;
    if (!accession || seen.has(accession)) continue;
    if (!matchesTicker(src.display_names, ticker)) continue;
    seen.add(accession);

    const cik = src.ciks?.[0] ?? "";
    const displayName = src.display_names?.[0] ?? "";
    // Extract entity name from display format: "APPLE INC  (AAPL)  (CIK 0000320193)"
    const entityName = displayName.split("(")[0]?.trim() ?? displayName;
    const archiveDir = buildEdgarArchiveDir(cik, accession);
    const primaryDocumentUrl = buildPrimaryDocumentUrl(archiveDir, hit._id);

    filings.push({
      formType: src.form ?? "",
      filedDate: src.file_date ?? "",
      periodOfReport: src.period_ending ?? "",
      entityName,
      accessionNumber: accession,
      url: `${archiveDir}/${accession}-index.htm`,
      primaryDocumentUrl,
      items: src.items ?? [],
    });

    if (filings.length >= limit) break;
  }

  if (options.includeSnippets) {
    await enrichWithEvidenceSnippets(filings, options.snippetLimitPerFiling ?? 3);
  }

  cache.set(cacheKey, filings, TTL.FUNDAMENTALS);
  return filings;
}

async function searchFilingsFromCompanySubmissions(
  ticker: string,
  formTypes: string[],
  limit: number,
): Promise<SECFiling[]> {
  const company = await resolveCompanyTicker(ticker);
  if (!company) return [];

  const cik = String(company.cik_str).padStart(10, "0");
  const data = await httpGet<SubmissionsResponse>(`${SUBMISSIONS_BASE}/CIK${cik}.json`, {
    headers: { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" },
  });

  const filings: SECFiling[] = [];
  const recent = data.filings.recent;
  for (let i = 0; i < recent.form.length && filings.length < limit; i++) {
    const formType = recent.form[i] ?? "";
    if (!formTypes.includes(formType)) continue;
    const accession = recent.accessionNumber[i];
    if (!accession) continue;
    const archiveDir = buildEdgarArchiveDir(cik, accession);
    const primaryDocument = recent.primaryDocument[i];
    filings.push({
      formType,
      filedDate: recent.filingDate[i] ?? "",
      periodOfReport: recent.reportDate[i] ?? "",
      entityName: data.name || company.title,
      accessionNumber: accession,
      url: `${archiveDir}/${accession}-index.htm`,
      primaryDocumentUrl: primaryDocument ? `${archiveDir}/${primaryDocument}` : undefined,
      items: splitFilingItems(recent.items?.[i]),
    });
  }
  return filings;
}

async function resolveCompanyTicker(ticker: string): Promise<CompanyTickerEntry | undefined> {
  const cacheKey = "sec:company-tickers";
  let companies = cache.get<CompanyTickerEntry[]>(cacheKey);
  if (!companies) {
    const data = await httpGet<Record<string, CompanyTickerEntry>>(COMPANY_TICKERS_URL, {
      headers: { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" },
    });
    companies = Object.values(data);
    cache.set(cacheKey, companies, TTL.FUNDAMENTALS);
  }
  const normalized = ticker.toUpperCase();
  return companies.find((company) => company.ticker.toUpperCase() === normalized);
}

function splitFilingItems(raw: string | undefined): string[] {
  return raw
    ? raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function matchesTicker(displayNames: string[] | undefined, ticker: string): boolean {
  const normalized = ticker.toUpperCase();
  return (displayNames ?? []).some((name) => {
    const tickerGroups = name.match(/\(([^)]*)\)/g) ?? [];
    return tickerGroups.some((group) =>
      group
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim().toUpperCase())
        .includes(normalized),
    );
  });
}

function buildEdgarArchiveDir(cik: string, accession: string): string {
  const cikNum = cik.replace(/^0+/, "");
  const accessionNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDash}`;
}

function buildPrimaryDocumentUrl(archiveDir: string, hitId: string): string | undefined {
  const fileName = hitId.split(":")[1];
  if (!fileName || !/\.(?:htm|html|txt)$/i.test(fileName)) return undefined;
  return `${archiveDir}/${fileName}`;
}

function getDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

async function enrichWithEvidenceSnippets(
  filings: SECFiling[],
  limitPerFiling: number,
): Promise<void> {
  await Promise.all(
    filings.map(async (filing) => {
      if (!filing.primaryDocumentUrl) return;
      try {
        const raw = await fetchText(filing.primaryDocumentUrl);
        filing.evidenceSnippets = extractEvidenceSnippets(raw, limitPerFiling);
      } catch (error) {
        filing.evidenceSnippets = [];
        filing.evidenceWarning = `Evidence fetch failed for primary document: ${error instanceof Error ? error.message : String(error)}`;
      }
    }),
  );
}

async function fetchText(url: string): Promise<string> {
  await rateLimiter.acquire("sec_edgar");
  const response = await fetch(url, {
    headers: { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" },
    signal: AbortSignal.timeout(SEC_DOCUMENT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

const EVIDENCE_KEYWORDS = [
  "risk factor",
  "legal proceedings",
  "litigation",
  "regulatory",
  "regulation",
  "revenue",
  "concentration",
  "management's discussion",
  "management discussion",
  "liquidity",
  "outlook",
  "guidance",
  "material weakness",
  "going concern",
];

function extractEvidenceSnippets(raw: string, limit: number): string[] {
  const text = stripFilingMarkup(raw);
  const snippets: string[] = [];
  const lower = text.toLowerCase();

  for (const keyword of EVIDENCE_KEYWORDS) {
    let searchFrom = 0;
    while (searchFrom < lower.length) {
      const index = lower.indexOf(keyword, searchFrom);
      if (index === -1) break;
      searchFrom = index + keyword.length;

      const start = Math.max(0, index - 220);
      const end = Math.min(text.length, index + keyword.length + 420);
      const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (
        snippet &&
        !isLikelyTableOfContentsSnippet(snippet) &&
        !snippets.some((existing) => existing.includes(snippet.slice(0, 80)))
      ) {
        snippets.push(snippet);
        break;
      }
    }
    if (snippets.length >= limit) break;
  }

  return snippets;
}

function stripFilingMarkup(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#160;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTableOfContentsSnippet(snippet: string): boolean {
  const lower = snippet.toLowerCase();
  const itemHeadingCount = lower.match(/\bitem\s+\d+[a-z]?\b/g)?.length ?? 0;
  return lower.includes("table of contents") && itemHeadingCount >= 2;
}
