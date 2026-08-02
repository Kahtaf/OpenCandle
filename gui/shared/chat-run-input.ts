import type { MarketStateService } from "../../src/market-state/service.js";
import {
  formatLatestReportSummary,
  formatPortfolioSummary,
  formatWatchlistSummary,
} from "../../src/market-state/summaries.js";

export interface ChatRunImageInput {
  data: string;
  mimeType: string;
}

export type ChatRunAttachmentInput =
  | { kind: "portfolio"; id?: string }
  | { kind: "watchlist"; id: string }
  | { kind: "report"; id: string };

export interface ParsedChatRunBody {
  prompt: string;
  images: ChatRunImageInput[];
  attachments: ChatRunAttachmentInput[];
}

export type ChatRunParseResult =
  | { ok: true; value: ParsedChatRunBody }
  | { ok: false; error: string };

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SAVED_STATE_ATTACHMENTS = 8;
const MAX_DISPATCHED_PROMPT_LENGTH = 64 * 1024;
const WORKFLOW_SYMBOL_PATTERN = /^[A-Z]{1,5}(?:[./-][A-Z]{1,2})?$/;

export function shouldPersistOriginalInputMarker(
  original: string,
  attachments: readonly { kind: string; label: string }[],
): boolean {
  if (!original.trim().startsWith("/")) return attachments.length > 0;
  const command = original.trim().match(/^\/analyze(?:\s+(.+))?$/i);
  const symbol = command?.[1]?.trim().replaceAll("$", "").toUpperCase();
  return symbol !== undefined && WORKFLOW_SYMBOL_PATTERN.test(symbol);
}

/** Shared local-GUI and hosted-web chat input contract. */
export function parseChatRunBody(body: unknown): ChatRunParseResult {
  const record = asRecord(body);
  const prompt = String(record.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "prompt is required" };

  const rawImages = record.images;
  const images: ChatRunImageInput[] = [];
  if (rawImages !== undefined) {
    if (!Array.isArray(rawImages)) return { ok: false, error: "images must be an array" };
    if (rawImages.length > MAX_IMAGE_COUNT) {
      return { ok: false, error: "Attach up to 4 images" };
    }
    for (const rawImage of rawImages) {
      const image = asRecord(rawImage);
      const mimeType = String(image.mimeType ?? "");
      const data = String(image.data ?? "");
      if (!IMAGE_MIME_TYPES.has(mimeType)) {
        return { ok: false, error: "Unsupported image mime type" };
      }
      if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
        return { ok: false, error: "Image attachment must be 5 MB or smaller" };
      }
      const decoded = decodeStrictBase64(data);
      if (!decoded) {
        return { ok: false, error: "Image attachment data must be valid base64" };
      }
      if (decoded.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, error: "Image attachment must be 5 MB or smaller" };
      }
      images.push({ data, mimeType });
    }
  }

  const rawAttachments = record.attachments;
  const attachments: ChatRunAttachmentInput[] = [];
  if (rawAttachments !== undefined) {
    if (!Array.isArray(rawAttachments)) {
      return { ok: false, error: "attachments must be an array" };
    }
    if (rawAttachments.length > MAX_SAVED_STATE_ATTACHMENTS) {
      return { ok: false, error: "Attach up to 8 saved items" };
    }
    const identities = new Set<string>();
    for (const rawAttachment of rawAttachments) {
      const attachment = asRecord(rawAttachment);
      const kind = String(attachment.kind ?? "");
      const id = typeof attachment.id === "string" ? attachment.id.trim() : "";
      if (kind === "portfolio") {
        attachments.push(id ? { kind, id } : { kind });
      } else if (kind === "watchlist" || kind === "report") {
        if (!id) return { ok: false, error: `${kind} attachment id is required` };
        attachments.push({ kind, id });
      } else {
        return { ok: false, error: "Unsupported attachment kind" };
      }
      const normalized = attachments.at(-1);
      const identity = normalized ? `${normalized.kind}:${normalized.id ?? "default"}` : "";
      if (identities.has(identity)) return { ok: false, error: "Duplicate saved attachment" };
      identities.add(identity);
    }
  }

  if (prompt.startsWith("/") && (images.length > 0 || attachments.length > 0)) {
    return { ok: false, error: "Attachments are not supported for slash commands" };
  }

  return { ok: true, value: { prompt, images, attachments } };
}

/** Expands saved-state attachments using the caller's state database. */
export function buildDispatchedPromptFromState(
  parsed: ParsedChatRunBody,
  service: MarketStateService,
): string {
  if (parsed.prompt.startsWith("/") || parsed.attachments.length === 0) return parsed.prompt;
  const blocks = parsed.attachments.map((attachment) => {
    const lines = attachmentSummaryLines(service, attachment);
    if (lines.length === 0) throw new Error(`${attachment.kind} attachment was empty`);
    return `[Attached by user — ${attachment.kind}]\n${lines.join("\n")}`;
  });
  const dispatched = [parsed.prompt, ...blocks].join("\n\n");
  if (dispatched.length > MAX_DISPATCHED_PROMPT_LENGTH) {
    throw new Error("Expanded prompt is too large");
  }
  return dispatched;
}

export function chatRunAttachmentLabel(attachment: ChatRunAttachmentInput): string {
  if (attachment.kind === "portfolio") return "Portfolio";
  if (attachment.kind === "watchlist") return "Watchlist";
  return "Latest report";
}

function attachmentSummaryLines(
  service: MarketStateService,
  attachment: ChatRunAttachmentInput,
): string[] {
  if (attachment.kind === "portfolio") {
    const portfolioId =
      attachment.id === "default" ? service.getDefaultPortfolio().id : Number(attachment.id);
    if (attachment.id && !Number.isFinite(portfolioId)) {
      throw new Error("Unknown portfolio attachment");
    }
    return formatPortfolioSummary(
      service.listPortfolioLots(attachment.id ? portfolioId : undefined),
    );
  }
  if (attachment.kind === "watchlist") {
    const watchlistId =
      attachment.id === "default" ? service.getDefaultWatchlist().id : Number(attachment.id);
    if (!Number.isFinite(watchlistId)) throw new Error("Unknown watchlist attachment");
    return formatWatchlistSummary(service.listWatchlistItems(watchlistId));
  }
  const reports = service.listReportRuns();
  const report =
    attachment.id === "latest"
      ? reports[0]
      : reports.find((candidate) => candidate.id === Number(attachment.id));
  if (!report) throw new Error("Unknown report attachment");
  return formatLatestReportSummary(report);
}

function decodeStrictBase64(data: string): Uint8Array | null {
  if (!data || data.trim() !== data || data.length % 4 !== 0) return null;
  if (/[^A-Za-z0-9+/=]/.test(data)) return null;
  const firstPadding = data.indexOf("=");
  if (firstPadding !== -1 && !/^={1,2}$/.test(data.slice(firstPadding))) return null;
  const decoded = Buffer.from(data, "base64");
  if (decoded.byteLength === 0) return null;
  return decoded.toString("base64") === data ? decoded : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
