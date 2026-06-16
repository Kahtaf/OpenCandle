// Tool-result text tags used by OpenCandle's conversational-provider-setup
// flow. These tagged lines are the LLM-facing contract — Pi provider adapters
// serialize the `content` field of tool results into the model's conversation,
// so any signal we want the model to reason over must live in text, not
// `details`.
//
// Tag format (single line, parseable):
//   [OPENCANDLE_<KIND> field=value field2=value ... ]
//
// Values may be:
//   - bare: provider=alpha_vantage  reason=missing  silenced=true  httpStatus=401
//   - quoted (for spaces or commas): remediation="run /connect economy"
//   - lists (comma-separated inside quotes): unlocks="fundamentals, DCF"
//   - null/absent: fallback=none
//
// Parser is tolerant of unknown fields and extra whitespace.

import type { ProviderId } from "./providers.js";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type CredentialRequiredReason = "missing" | "stale";
export type ExternalToolRequiredReason = "not_installed" | "session_missing" | "session_stale";

export interface CredentialRequiredTagFields {
  provider: ProviderId;
  reason: CredentialRequiredReason;
  unlocks: readonly string[];
  fallback: string | null;
  httpStatus?: number;
}

export interface SoftDegradedTagFields {
  provider: ProviderId;
  fallback: string;
  remediation: string;
}

export interface SkippedTagFields {
  provider: ProviderId;
  reason: "credential_not_provided";
  remediation: string;
  silenced?: boolean;
}

export interface ConnectedTagFields {
  provider: ProviderId;
}

export interface ExternalToolRequiredTagFields {
  provider: ProviderId;
  reason: ExternalToolRequiredReason;
  installCmd: string;
  loginCmd?: string;
  fallback: string | null;
}

export type ParsedTag =
  | ({ kind: "credential_required" } & CredentialRequiredTagFields)
  | ({ kind: "soft_degraded" } & SoftDegradedTagFields)
  | ({ kind: "skipped" } & SkippedTagFields)
  | ({ kind: "connected" } & ConnectedTagFields)
  | ({ kind: "external_tool_required" } & ExternalToolRequiredTagFields);

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatField(key: string, value: string | number | boolean): string {
  return `${key}=${value}`;
}

export function buildCredentialRequiredTag(fields: CredentialRequiredTagFields): string {
  const parts: string[] = [
    "[OPENCANDLE_CREDENTIAL_REQUIRED",
    formatField("provider", fields.provider),
    formatField("reason", fields.reason),
    `unlocks=${quote(fields.unlocks.join(", "))}`,
    formatField("fallback", fields.fallback ?? "none"),
  ];
  if (fields.httpStatus !== undefined) {
    parts.push(formatField("httpStatus", fields.httpStatus));
  }
  return `${parts.join(" ")}]`;
}

export function buildSoftDegradedTag(fields: SoftDegradedTagFields): string {
  return `${[
    "[OPENCANDLE_SOFT_DEGRADED",
    formatField("provider", fields.provider),
    formatField("fallback", fields.fallback),
    `remediation=${quote(fields.remediation)}`,
  ].join(" ")}]`;
}

export function buildSkippedTag(fields: SkippedTagFields): string {
  const parts: string[] = [
    "[OPENCANDLE_SKIPPED",
    formatField("provider", fields.provider),
    formatField("reason", fields.reason),
    `remediation=${quote(fields.remediation)}`,
  ];
  if (fields.silenced) {
    parts.push(formatField("silenced", "true"));
  }
  return `${parts.join(" ")}]`;
}

export function buildConnectedTag(fields: ConnectedTagFields): string {
  return `[OPENCANDLE_CONNECTED provider=${fields.provider}]`;
}

export function buildExternalToolRequiredTag(fields: ExternalToolRequiredTagFields): string {
  const parts: string[] = [
    "[OPENCANDLE_EXTERNAL_TOOL_REQUIRED",
    formatField("provider", fields.provider),
    formatField("reason", fields.reason),
    `installCmd=${quote(fields.installCmd)}`,
    formatField("fallback", fields.fallback ?? "none"),
  ];
  if (fields.loginCmd) parts.push(`loginCmd=${quote(fields.loginCmd)}`);
  return `${parts.join(" ")}]`;
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

const TAG_LINE_REGEX =
  /\[OPENCANDLE_(CREDENTIAL_REQUIRED|SOFT_DEGRADED|SKIPPED|CONNECTED|EXTERNAL_TOOL_REQUIRED)([^\]]*)\]/;

function parseFields(raw: string): Record<string, string> {
  // Split on `key=value` pairs, respecting quoted values.
  const fields: Record<string, string> = {};
  const pattern = /(\w+)=("((?:[^"\\]|\\.)*)"|([^\s\]]+))/g;
  while (true) {
    const match = pattern.exec(raw);
    if (!match) break;
    const key = match[1];
    const value = match[3] !== undefined ? match[3].replace(/\\"/g, '"') : match[4];
    fields[key] = value;
  }
  return fields;
}

export function parseToolTag(text: string): ParsedTag | undefined {
  const match = TAG_LINE_REGEX.exec(text);
  if (!match) return undefined;

  const kind = match[1];
  const rest = match[2];
  const fields = parseFields(rest);

  switch (kind) {
    case "CREDENTIAL_REQUIRED": {
      const provider = fields.provider;
      const reason = fields.reason;
      const unlocksRaw = fields.unlocks ?? "";
      const fallbackRaw = fields.fallback;
      if (!provider || (reason !== "missing" && reason !== "stale")) {
        return undefined;
      }
      const unlocks = unlocksRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const fallback = fallbackRaw === undefined || fallbackRaw === "none" ? null : fallbackRaw;
      const parsed: ParsedTag = {
        kind: "credential_required",
        provider: provider as ProviderId,
        reason: reason as CredentialRequiredReason,
        unlocks,
        fallback,
      };
      if (fields.httpStatus !== undefined) {
        const n = Number(fields.httpStatus);
        if (!Number.isNaN(n)) parsed.httpStatus = n;
      }
      return parsed;
    }

    case "SOFT_DEGRADED": {
      const { provider, fallback, remediation } = fields;
      if (!provider || !fallback || !remediation) return undefined;
      return {
        kind: "soft_degraded",
        provider: provider as ProviderId,
        fallback,
        remediation,
      };
    }

    case "SKIPPED": {
      const { provider, reason, remediation } = fields;
      if (!provider || reason !== "credential_not_provided" || !remediation) {
        return undefined;
      }
      const parsed: ParsedTag = {
        kind: "skipped",
        provider: provider as ProviderId,
        reason: "credential_not_provided",
        remediation,
      };
      if (fields.silenced === "true") parsed.silenced = true;
      return parsed;
    }

    case "CONNECTED": {
      const { provider } = fields;
      if (!provider) return undefined;
      return { kind: "connected", provider: provider as ProviderId };
    }

    case "EXTERNAL_TOOL_REQUIRED": {
      const { provider, reason, installCmd, loginCmd, fallback } = fields;
      if (
        !provider ||
        (reason !== "not_installed" &&
          reason !== "session_missing" &&
          reason !== "session_stale") ||
        !installCmd
      ) {
        return undefined;
      }
      return {
        kind: "external_tool_required",
        provider: provider as ProviderId,
        reason,
        installCmd,
        loginCmd,
        fallback: fallback === undefined || fallback === "none" ? null : fallback,
      };
    }

    default:
      return undefined;
  }
}
