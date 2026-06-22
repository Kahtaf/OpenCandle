import type { TwitterTweet } from "../types/sentiment.js";
import { type ExternalToolCommandResult, runExternalToolCommand } from "./external-tool-command.js";
import { ExternalToolError, ExternalToolNotInstalled } from "./external-tool-error.js";

const TWITTER_CLI_BINARY = "twitter";
const TWITTER_CLI_TOOL_NAME = "twitter-cli";
const TWITTER_CLI_INSTALL_CMD = "uv tool install twitter-cli";
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 2_000_000;

export interface RawTweet {
  readonly id?: string;
  readonly text?: string;
  readonly author?: {
    readonly username?: string;
    readonly screenName?: string;
    readonly name?: string;
  };
  readonly username?: string;
  readonly url?: string;
  readonly permanentUrl?: string;
  readonly createdAt?: string | number;
  readonly created_at?: string | number;
  readonly likeCount?: number;
  readonly likes?: number;
  readonly retweetCount?: number;
  readonly retweets?: number;
  readonly replyCount?: number;
  readonly replies?: number;
  readonly viewCount?: number | null;
  readonly views?: number | null;
  readonly metrics?: {
    readonly likes?: number;
    readonly retweets?: number;
    readonly replies?: number;
    readonly views?: number | null;
  };
}

interface TwitterCliEnvelope<T> {
  readonly ok: boolean;
  readonly schema_version: string;
  readonly data: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

type TwitterCliCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<ExternalToolCommandResult>;

let commandRunner: TwitterCliCommandRunner = runCommand;

export function setTwitterCliCommandRunnerForTests(runner: TwitterCliCommandRunner): void {
  commandRunner = runner;
}

export function resetTwitterCliCommandRunnerForTests(): void {
  commandRunner = runCommand;
}

export async function searchTweets(query: string, max = 20): Promise<TwitterTweet[]> {
  const envelope = await runTwitterCli<TwitterCliEnvelope<RawTweet[]>>([
    "search",
    query,
    "--max",
    String(max),
    "-t",
    "Latest",
    "--json",
  ]);

  if (!envelope.ok) {
    throw new ExternalToolError(
      TWITTER_CLI_TOOL_NAME,
      redactSensitiveOutput(envelope.error?.message ?? "twitter-cli returned an error"),
      envelope.error?.code,
    );
  }
  if (!Array.isArray(envelope.data)) {
    throw new ExternalToolError(TWITTER_CLI_TOOL_NAME, "twitter-cli returned invalid tweet data");
  }
  return envelope.data.map(adaptRawTweet);
}

async function runTwitterCli<T>(args: readonly string[]): Promise<T> {
  let result: ExternalToolCommandResult;
  try {
    result = await commandRunner(TWITTER_CLI_BINARY, args);
  } catch (err) {
    const nodeError = err as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      throw new ExternalToolNotInstalled(TWITTER_CLI_TOOL_NAME, TWITTER_CLI_INSTALL_CMD);
    }
    throw new ExternalToolError(
      TWITTER_CLI_TOOL_NAME,
      redactSensitiveOutput(err instanceof Error ? err.message : String(err)),
    );
  }

  if (result.code !== 0) {
    const envelopeError = parseCliErrorEnvelope(result.stdout);
    if (envelopeError) {
      throw new ExternalToolError(
        TWITTER_CLI_TOOL_NAME,
        redactSensitiveOutput(envelopeError.message),
        envelopeError.code,
      );
    }
    throw new ExternalToolError(
      TWITTER_CLI_TOOL_NAME,
      redactSensitiveOutput(result.stderr.trim() || `twitter-cli exited with code ${result.code}`),
    );
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new ExternalToolError(
      TWITTER_CLI_TOOL_NAME,
      `twitter-cli returned non-JSON output: ${redactSensitiveOutput(result.stdout.slice(0, 200))}`,
    );
  }
}

function parseCliErrorEnvelope(stdout: string): { code?: string; message: string } | null {
  try {
    const parsed = JSON.parse(stdout) as {
      ok?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (parsed.ok !== false || typeof parsed.error?.message !== "string") return null;
    return {
      code: typeof parsed.error.code === "string" ? parsed.error.code : undefined,
      message: parsed.error.message,
    };
  } catch {
    return null;
  }
}

function adaptRawTweet(raw: RawTweet): TwitterTweet {
  return {
    id: stringValue(raw.id),
    text: stringValue(raw.text).slice(0, 280),
    author:
      stringValue(raw.author?.username) ||
      stringValue(raw.author?.screenName) ||
      stringValue(raw.username) ||
      "unknown",
    likes: numberValue(raw.metrics?.likes ?? raw.likeCount ?? raw.likes),
    retweets: numberValue(raw.metrics?.retweets ?? raw.retweetCount ?? raw.retweets),
    replies: numberValue(raw.metrics?.replies ?? raw.replyCount ?? raw.replies),
    views: nullableNumberValue(raw.metrics?.views ?? raw.viewCount ?? raw.views),
    url: stringValue(raw.url ?? raw.permanentUrl),
    created: normalizeCreatedAt(raw.createdAt ?? raw.created_at),
  };
}

function normalizeCreatedAt(value: string | number | undefined): string {
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const millis = Date.parse(value);
    if (!Number.isNaN(millis)) return new Date(millis).toISOString();
  }
  return new Date(0).toISOString();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function redactSensitiveOutput(input: string): string {
  const xCookieNames =
    "auth_token|ct0|twid|kdt|guest_id|guest_id_ads|guest_id_marketing|personalization_id";
  return input
    .slice(0, MAX_OUTPUT_CHARS)
    .replace(/\b(cookie|set-cookie)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(new RegExp(`\\b(${xCookieNames})\\b\\s*[:=]\\s*[^;\\s,)]+`, "gi"), "$1=[redacted]")
    .replace(new RegExp(`\\b(${xCookieNames})=([^;\\s,)]+)`, "gi"), "$1=[redacted]");
}

function runCommand(command: string, args: readonly string[]): Promise<ExternalToolCommandResult> {
  return runExternalToolCommand(command, args, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxOutputChars: MAX_OUTPUT_CHARS,
  });
}
