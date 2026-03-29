import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";

const EFTS_BASE = "https://efts.sec.gov/LATEST/search-index";

export interface SECFiling {
  formType: string;
  filedDate: string;
  periodOfReport: string;
  entityName: string;
  accessionNumber: string;
  url: string;
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
      };
    }>;
  };
}

export async function searchFilings(
  ticker: string,
  formTypes: string[] = ["10-K", "10-Q", "8-K"],
  limit: number = 10,
): Promise<SECFiling[]> {
  const cacheKey = `sec:${ticker}:${formTypes.join(",")}:${limit}`;
  const cached = cache.get<SECFiling[]>(cacheKey);
  if (cached) return cached;

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
    headers: { "User-Agent": "Vantage/1.0 (financial analysis agent)" },
  });

  // Deduplicate by accession number (EDGAR returns multiple hits per filing)
  const seen = new Set<string>();
  const filings: SECFiling[] = [];

  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source;
    const accession = src.adsh;
    if (!accession || seen.has(accession)) continue;
    seen.add(accession);

    const cik = src.ciks?.[0] ?? "";
    const displayName = src.display_names?.[0] ?? "";
    // Extract entity name from display format: "APPLE INC  (AAPL)  (CIK 0000320193)"
    const entityName = displayName.split("(")[0]?.trim() ?? displayName;

    filings.push({
      formType: src.form ?? "",
      filedDate: src.file_date ?? "",
      periodOfReport: src.period_ending ?? "",
      entityName,
      accessionNumber: accession,
      url: buildEdgarUrl(cik, accession),
    });

    if (filings.length >= limit) break;
  }

  cache.set(cacheKey, filings, TTL.FUNDAMENTALS);
  return filings;
}

function buildEdgarUrl(cik: string, accession: string): string {
  const accessionNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40&search_text=&action=getcompany`;
}

function getDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}
