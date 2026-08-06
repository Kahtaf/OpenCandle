import {
  type ExternalToolCommandResult,
  runExternalToolCommand,
} from "../providers/external-tool-command.js";
import type { ProviderId } from "./providers.js";
import {
  getCredentialSource,
  getProvider,
  isApiKeyProvider,
  isExternalToolProvider,
  isPublicHttpProvider,
} from "./providers.js";
import { loadOnboardingState } from "./state.js";

const STATUS_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 5_000;
const PUBLIC_HTTP_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_CHARS = 32_000;

export type CommandResult = ExternalToolCommandResult;

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs: number },
) => Promise<CommandResult>;

interface ProviderStatusBase {
  readonly providerId: ProviderId;
  readonly kind: "api-key" | "external-tool" | "public-http";
  readonly state: string;
  readonly checkedAt: string;
  readonly cacheHit: boolean;
  readonly message?: string;
}

export interface ApiKeyProviderStatus extends ProviderStatusBase {
  readonly kind: "api-key";
  readonly state: "configured" | "missing";
  readonly credentialSource: "env" | "file" | "absent";
}

export interface ExternalToolProviderStatus extends ProviderStatusBase {
  readonly kind: "external-tool";
  readonly mode: "install" | "session";
  readonly state:
    | "installed"
    | "missing"
    | "session_ok"
    | "session_missing"
    | "session_stale"
    | "skipped"
    | "error";
  readonly installCmd?: string;
}

export interface PublicHttpProviderStatus extends ProviderStatusBase {
  readonly kind: "public-http";
  readonly state: "reachable" | "unreachable" | "error";
  readonly statusCode?: number;
}

export type ProviderStatus =
  | ApiKeyProviderStatus
  | ExternalToolProviderStatus
  | PublicHttpProviderStatus;

export interface ProbeProviderStatusOptions {
  readonly mode?: "install" | "session";
  readonly force?: boolean;
  readonly respectSkipped?: boolean;
  readonly commandRunner?: CommandRunner;
  readonly fetchImpl?: typeof fetch;
  readonly now?: Date;
}

interface CachedStatus {
  readonly expiresAt: number;
  readonly status: ProviderStatus;
}

const statusCache = new Map<string, CachedStatus>();

export function clearProviderStatusCache(): void {
  statusCache.clear();
}

export async function probeProviderStatus(
  providerId: ProviderId,
  options: ProbeProviderStatusOptions = {},
): Promise<ProviderStatus> {
  const provider = getProvider(providerId);
  const mode = isExternalToolProvider(provider) ? (options.mode ?? "install") : "default";
  const cacheKey = `${providerId}:${mode}`;
  const now = options.now ?? new Date();
  const skippedByPreference =
    isExternalToolProvider(provider) &&
    loadOnboardingState().providers[providerId]?.status === "never_ask";

  if (skippedByPreference && (!options.force || options.respectSkipped)) {
    return {
      providerId,
      kind: "external-tool",
      mode: mode as "install" | "session",
      state: "skipped",
      installCmd: provider.installCmd,
      message: `Skipped by user preference; run opencandle doctor --enable ${providerId} to re-enable.`,
      checkedAt: now.toISOString(),
      cacheHit: false,
    };
  }

  if (!options.force) {
    const cached = statusCache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) {
      return { ...cached.status, cacheHit: true };
    }
  }

  let status: ProviderStatus;
  if (isApiKeyProvider(provider)) {
    const source = getCredentialSource(provider.id);
    status = {
      providerId,
      kind: "api-key",
      state: source === "absent" ? "missing" : "configured",
      credentialSource: source,
      checkedAt: now.toISOString(),
      cacheHit: false,
    };
  } else if (isExternalToolProvider(provider)) {
    status = await probeExternalTool(providerId, mode as "install" | "session", {
      now,
      commandRunner: options.commandRunner ?? runCommand,
    });
  } else if (isPublicHttpProvider(provider)) {
    status = await probePublicHttp(providerId, {
      now,
      fetchImpl: options.fetchImpl ?? fetch,
    });
  } else {
    const exhaustive: never = provider;
    throw new Error(`Unsupported provider kind: ${JSON.stringify(exhaustive)}`);
  }

  statusCache.set(cacheKey, { status, expiresAt: now.getTime() + STATUS_TTL_MS });
  return status;
}

export async function probeAllProviderStatuses(
  options: Omit<ProbeProviderStatusOptions, "mode"> = {},
): Promise<ProviderStatus[]> {
  const { listAllProviders } = await import("./providers.js");
  const statuses: ProviderStatus[] = [];
  for (const provider of listAllProviders()) {
    statuses.push(await probeProviderStatus(provider.id, options));
  }
  return statuses;
}

export function formatProviderStatus(status: ProviderStatus): string {
  const provider = getProvider(status.providerId);
  if (status.kind === "api-key") {
    return `${provider.displayName}: ${status.state} (${status.credentialSource})`;
  }
  if (status.kind === "external-tool") {
    const suffix = status.message ? ` - ${status.message}` : "";
    return `${provider.displayName}: ${status.state} (${status.mode})${suffix}`;
  }
  const http = status.statusCode === undefined ? "" : ` HTTP ${status.statusCode}`;
  const suffix = status.message ? ` - ${status.message}` : "";
  return `${provider.displayName}: ${status.state}${http}${suffix}`;
}

async function probeExternalTool(
  providerId: ProviderId,
  mode: "install" | "session",
  options: { now: Date; commandRunner: CommandRunner },
): Promise<ExternalToolProviderStatus> {
  const provider = getProvider(providerId);
  if (!isExternalToolProvider(provider)) {
    throw new Error(`Provider ${providerId} is not an external tool`);
  }

  const args =
    mode === "install"
      ? ["--version"]
      : (provider.sessionProbeArgs ?? ["feed", "--max", "1", "--json"]);
  try {
    const result = await options.commandRunner(provider.binary, args, {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const output = redactSensitiveOutput(`${result.stderr}\n${result.stdout}`.trim());

    if (mode === "install") {
      return {
        providerId,
        kind: "external-tool",
        mode,
        state: result.code === 0 ? "installed" : "error",
        installCmd: provider.installCmd,
        message: result.code === 0 ? undefined : output,
        checkedAt: options.now.toISOString(),
        cacheHit: false,
      };
    }

    if (result.code === 0) {
      const parsed = parseCliEnvelope(result.stdout, provider.binary);
      const session = classifySessionEnvelope(providerId, parsed);
      return {
        providerId,
        kind: "external-tool",
        mode,
        state: session.state,
        installCmd: provider.installCmd,
        message: session.message,
        checkedAt: options.now.toISOString(),
        cacheHit: false,
      };
    }

    return {
      providerId,
      kind: "external-tool",
      mode,
      state: classifySessionFailure(output),
      installCmd: provider.installCmd,
      message: output,
      checkedAt: options.now.toISOString(),
      cacheHit: false,
    };
  } catch (err) {
    const nodeError = err as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        providerId,
        kind: "external-tool",
        mode,
        state: "missing",
        installCmd: provider.installCmd,
        checkedAt: options.now.toISOString(),
        cacheHit: false,
      };
    }
    return {
      providerId,
      kind: "external-tool",
      mode,
      state: "error",
      installCmd: provider.installCmd,
      message: redactSensitiveOutput(err instanceof Error ? err.message : String(err)),
      checkedAt: options.now.toISOString(),
      cacheHit: false,
    };
  }
}

async function probePublicHttp(
  providerId: ProviderId,
  options: { now: Date; fetchImpl: typeof fetch },
): Promise<PublicHttpProviderStatus> {
  const provider = getProvider(providerId);
  if (!isPublicHttpProvider(provider)) {
    throw new Error(`Provider ${providerId} is not a public HTTP provider`);
  }

  try {
    const response = await options.fetchImpl(provider.probeUrl, {
      method: "GET",
      ...(provider.probeHeaders ? { headers: provider.probeHeaders } : {}),
      signal: AbortSignal.timeout(PUBLIC_HTTP_TIMEOUT_MS),
    });
    return {
      providerId,
      kind: "public-http",
      state: response.ok ? "reachable" : "unreachable",
      statusCode: response.status,
      checkedAt: options.now.toISOString(),
      cacheHit: false,
    };
  } catch (err) {
    return {
      providerId,
      kind: "public-http",
      state: "error",
      message: err instanceof Error ? err.message : String(err),
      checkedAt: options.now.toISOString(),
      cacheHit: false,
    };
  }
}

function parseCliEnvelope(
  stdout: string,
  binary: string,
): { ok: boolean; message?: string; data?: unknown } {
  try {
    const parsed = JSON.parse(stdout) as {
      ok?: unknown;
      data?: unknown;
      error?: { message?: unknown };
    };
    return {
      ok: parsed.ok === true,
      data: parsed.data,
      message:
        typeof parsed.error?.message === "string"
          ? redactSensitiveOutput(parsed.error.message)
          : undefined,
    };
  } catch {
    return { ok: false, message: `${binary} returned non-JSON output` };
  }
}

function classifySessionEnvelope(
  providerId: ProviderId,
  parsed: { ok: boolean; message?: string; data?: unknown },
): { state: ExternalToolProviderStatus["state"]; message?: string } {
  if (!parsed.ok) {
    return {
      state: classifySessionFailure(parsed.message),
      message: parsed.message,
    };
  }

  if (providerId === "reddit" && isRecord(parsed.data) && parsed.data.authenticated === false) {
    return {
      state: "session_missing",
      message: "Reddit is not authenticated. Run rdt login.",
    };
  }

  return { state: "session_ok" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function classifySessionFailure(message: string | undefined): ExternalToolProviderStatus["state"] {
  const lower = (message ?? "").toLowerCase();
  if (
    lower.includes("no twitter cookies") ||
    lower.includes("no reddit cookies") ||
    lower.includes("not authenticated") ||
    lower.includes("no cookies")
  ) {
    return "session_missing";
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("expired")) {
    return "session_stale";
  }
  return "error";
}

export function redactSensitiveOutput(input: string): string {
  const xCookieNames =
    "auth_token|ct0|twid|kdt|guest_id|guest_id_ads|guest_id_marketing|personalization_id";
  const genericSecretName =
    "[a-z0-9_]*(?:session|token)[a-z0-9_]*|[a-z0-9_]+cookie[a-z0-9_]*|[a-z0-9_]*cookie[a-z0-9_]+";
  return input
    .slice(0, MAX_OUTPUT_CHARS)
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(new RegExp(`\\b(${xCookieNames})\\b\\s*[:=]\\s*[^;\\s,)]+`, "gi"), "$1=[redacted]")
    .replace(new RegExp(`\\b(${xCookieNames})=([^;\\s,)]+)`, "gi"), "$1=[redacted]")
    .replace(
      new RegExp(`\\b(${genericSecretName})\\b\\s*[:=]\\s*[^;\\s,)]+`, "gi"),
      "$1=[redacted]",
    )
    .replace(new RegExp(`\\b(${genericSecretName})=([^;\\s,)]+)`, "gi"), "$1=[redacted]")
    .replace(
      /(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/\.config\/rdt-cli\/credential\.json/g,
      "[redacted-credential-path]",
    );
}

export const runCommand: CommandRunner = (command, args, options) =>
  runExternalToolCommand(command, args, {
    timeoutMs: options?.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxOutputChars: MAX_OUTPUT_CHARS,
  });
