import { extractDetails } from "../renderers/cards/card-format.js";

const FUNDAMENTAL_FIELDS = [
  "name",
  "marketCap",
  "pe",
  "forwardPe",
  "eps",
  "profitMargin",
  "revenueGrowth",
  "dividendYield",
  "beta",
];

const QUOTE_FIELDS = [
  "symbol",
  "name",
  "price",
  "currentPrice",
  "change",
  "changePercent",
  "open",
  "high",
  "low",
  "previousClose",
  "volume",
  "marketCap",
  "pe",
  "week52High",
  "week52Low",
  "timestamp",
  "asOf",
  "freshness",
];

export function collectSessionMarketFacts(rows = []) {
  const facts = {};
  for (const message of toolMessagesFromRows(rows)) {
    mergeFactsFromToolMessage(facts, message);
  }
  return facts;
}

export function enrichGroupedRows(rows = [], facts = {}) {
  if (!rows.length) return rows;
  return rows.map((row) => {
    if (row?.type === "tool_result") {
      return { ...row, message: enrichToolMessage(row.message, facts) };
    }
    if (row?.type === "tool_run") {
      return {
        ...row,
        steps: (row.steps || []).map((step) => ({
          ...step,
          result: step.result ? enrichToolMessage(step.result, facts) : step.result,
        })),
      };
    }
    return row;
  });
}

export function enrichToolMessage(message, facts = {}) {
  if (message?.toolName !== "get_stock_quote") return message;
  const details = enrichStockQuoteDetails(extractDetails(message), facts);
  if (details === extractDetails(message)) return message;
  return { ...message, details };
}

export function enrichStockQuoteDetails(details, facts = {}) {
  const symbol = normalizeSymbol(details?.symbol);
  if (!symbol) return details;
  const fact = facts[symbol];
  if (!fact) return details;
  return mergeDefined({ ...details }, fact, FUNDAMENTAL_FIELDS);
}

function mergeFactsFromToolMessage(facts, message) {
  const details = extractDetails(message);
  if (!details || typeof details !== "object") return;

  if (message?.toolName === "get_stock_quote") {
    mergeSymbolFact(facts, details.symbol, details, QUOTE_FIELDS);
    return;
  }

  if (message?.toolName === "get_company_overview") {
    mergeSymbolFact(facts, details.symbol, details, FUNDAMENTAL_FIELDS);
    return;
  }

  if (message?.toolName === "compare_companies") {
    for (const company of details.companies || []) {
      mergeSymbolFact(facts, company?.symbol, company, FUNDAMENTAL_FIELDS);
    }
    mergeComparisonMetrics(facts, details);
  }
}

function mergeComparisonMetrics(facts, details) {
  for (const metric of details?.metrics || []) {
    const field = fieldForMetric(metric?.metric);
    if (!field) continue;
    for (const [symbol, value] of Object.entries(metric.values || {})) {
      mergeSymbolFact(facts, symbol, { [field]: value }, [field]);
    }
  }
}

function toolMessagesFromRows(rows) {
  const messages = [];
  for (const row of rows || []) {
    if (row?.type === "tool_result" && row.message) {
      messages.push(row.message);
      continue;
    }
    if (row?.type === "tool_run") {
      for (const step of row.steps || []) {
        if (step?.result) messages.push(step.result);
      }
    }
  }
  return messages;
}

function mergeSymbolFact(facts, rawSymbol, source, fields) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol || !source || typeof source !== "object") return;
  const current = facts[symbol] || { symbol };
  facts[symbol] = mergeDefined(current, { ...source, symbol }, fields);
}

function mergeDefined(target, source, fields) {
  for (const field of fields) {
    const value = source?.[field];
    if (!hasValue(value, field)) continue;
    target[field] = value;
  }
  return target;
}

function normalizeSymbol(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase();
  return normalized || "";
}

function hasValue(value, field = "") {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  if (
    typeof value === "number" &&
    value === 0 &&
    !["change", "changePercent", "dividendYield"].includes(field)
  )
    return false;
  return true;
}

function fieldForMetric(metric) {
  const normalized = String(metric || "").toLowerCase();
  if (normalized === "p/e") return "pe";
  if (normalized === "forward p/e") return "forwardPe";
  if (normalized === "eps") return "eps";
  if (normalized === "profit margin") return "profitMargin";
  if (normalized === "revenue growth") return "revenueGrowth";
  if (normalized === "dividend yield") return "dividendYield";
  if (normalized === "beta") return "beta";
  return "";
}
