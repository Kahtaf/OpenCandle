// Walk a tool_run's steps and collect every "source-like" link the tools
// surfaced. Used by the StepsCard (compact stack pill), the assistant message
// (SourceGrid above the answer), and the drawer (full list view).
//
// We're permissive about shape: providers nest results under different keys
// (results, fresh, records, filings, sources) so the extractor inspects all
// of them. Dedupe by URL.
export function extractRunSources(run) {
  if (!run?.steps) return [];
  const seen = new Set();
  const out = [];
  for (const step of run.steps) {
    const result = step.result;
    if (!result) continue;
    const details = result.details?.value ?? result.details ?? {};
    const collected = collectFromTool(step.name, details);
    for (const src of collected) {
      const key = src.url || `${src.title || ""}::${src.source || ""}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(src);
    }
  }
  return out;
}

function collectFromTool(_name, details) {
  if (!details || typeof details !== "object") return [];

  // search_web → { results: [{ url, title, snippet, source, ... }] }
  if (Array.isArray(details.results)) {
    return details.results
      .filter((r) => r && (r.url || r.title))
      .map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        source: r.source,
        published: r.published,
      }));
  }

  // web_sentiment → { fresh: [{ url, title, ... }], records: [...] }
  const records = Array.isArray(details.fresh)
    ? details.fresh
    : Array.isArray(details.records)
      ? details.records
      : null;
  if (records) {
    return records
      .filter((r) => r && (r.url || r.title))
      .map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.snippet ?? r.summary,
        source: r.source ?? r.publisher,
        published: r.published,
      }));
  }

  // sec_filings → { filings: [{ url, formType, periodOfReport, ... }] }
  if (Array.isArray(details.filings)) {
    return details.filings
      .filter((f) => f && (f.url || f.documentUrl || f.link))
      .slice(0, 20)
      .map((f) => ({
        url: f.url || f.documentUrl || f.link,
        title: `${f.formType || f.form || "Filing"}${f.periodOfReport ? ` · ${f.periodOfReport}` : ""}`,
        snippet: f.entityName || f.title || f.description,
        source: "sec.gov",
        published: f.filedDate || f.filedAt,
      }));
  }

  // social sentiment → { tweets / posts: [{ url, ... }] }
  const social = Array.isArray(details.tweets)
    ? details.tweets
    : Array.isArray(details.posts)
      ? details.posts
      : null;
  if (social) {
    return social
      .filter((p) => p && (p.url || p.permalink))
      .slice(0, 20)
      .map((p) => ({
        url: p.url || p.permalink,
        title: p.title || p.text,
        snippet: p.text || p.body,
        source: p.author || p.subreddit,
        published: p.created,
      }));
  }

  // sentiment_summary → maybe a per-source list with urls
  if (Array.isArray(details.sources) && details.sources.every((s) => typeof s === "object")) {
    return details.sources
      .filter((s) => s?.url)
      .map((s) => ({ url: s.url, title: s.title, source: s.name, snippet: s.snippet }));
  }

  return [];
}
