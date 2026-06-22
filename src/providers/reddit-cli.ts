import { type ExternalToolCommandResult, runExternalToolCommand } from "./external-tool-command.js";
import { ExternalToolError, ExternalToolNotInstalled } from "./external-tool-error.js";
import type { RedditComment } from "./reddit.js";

const RDT_BINARY = "rdt";
const RDT_INSTALL_CMD = "uv tool install rdt-cli";
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 2_000_000;

interface RdtEnvelope<T> {
  readonly ok: boolean;
  readonly schema_version: string;
  readonly data?: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export interface RdtPost {
  readonly id: string;
  readonly title: string;
  readonly selftext: string;
  readonly author: string;
  readonly score: number;
  readonly comments: number;
  readonly subreddit?: string;
  readonly url: string;
  readonly permalink?: string;
  readonly created: string;
}

interface RawRdtPost {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly selftext?: unknown;
  readonly author?: unknown;
  readonly score?: unknown;
  readonly num_comments?: unknown;
  readonly subreddit?: unknown;
  readonly url?: unknown;
  readonly permalink?: unknown;
  readonly created_utc?: unknown;
}

interface RawRdtComment {
  readonly id?: unknown;
  readonly body?: unknown;
  readonly author?: unknown;
  readonly score?: unknown;
  readonly permalink?: unknown;
}

interface RdtListingChild<T> {
  readonly kind?: string;
  readonly data?: T;
}

interface RdtListing<T> {
  readonly data?: {
    readonly children?: Array<RdtListingChild<T>>;
  };
}

type RdtCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<ExternalToolCommandResult>;

let commandRunner: RdtCommandRunner = runCommand;

export function setRdtCommandRunnerForTests(runner: RdtCommandRunner): void {
  commandRunner = runner;
}

export function resetRdtCommandRunnerForTests(): void {
  commandRunner = runCommand;
}

export async function searchRedditPosts(
  query: string,
  opts: { subreddit?: string; limit: number },
): Promise<RdtPost[]> {
  const args = ["search", query];
  if (opts.subreddit) {
    args.push("--subreddit", opts.subreddit);
  }
  args.push("--json", "--compact", "-n", String(opts.limit));
  const data = await runRdt<RawRdtPost[]>(args);
  if (!Array.isArray(data)) {
    throw new ExternalToolError(RDT_BINARY, "rdt-cli returned invalid search data");
  }
  return data.map(adaptPost).filter((post) => post.id.length > 0);
}

export async function listSubredditPosts(
  subreddit: string,
  opts: { limit: number },
): Promise<RdtPost[]> {
  const data = await runRdt<RawRdtPost[]>([
    "sub",
    subreddit,
    "--json",
    "--compact",
    "-n",
    String(opts.limit),
  ]);
  if (!Array.isArray(data)) {
    throw new ExternalToolError(RDT_BINARY, "rdt-cli returned invalid subreddit data");
  }
  return data.map((raw) => adaptPost({ ...raw, subreddit })).filter((post) => post.id.length > 0);
}

export async function readRedditPost(
  postId: string,
  opts: { limit: number },
): Promise<{ post: RdtPost; comments: RedditComment[] }> {
  const data = await runRdt<Array<RdtListing<RawRdtPost | RawRdtComment>>>([
    "read",
    postId,
    "--json",
    "-n",
    String(opts.limit),
  ]);
  if (!Array.isArray(data)) {
    throw new ExternalToolError(RDT_BINARY, "rdt-cli returned invalid read data");
  }

  const rawPost = data[0]?.data?.children?.find((child) => child.kind === "t3")?.data;
  if (!rawPost) {
    throw new ExternalToolError(RDT_BINARY, "rdt-cli read output did not include a post");
  }

  const post = adaptPost(rawPost as RawRdtPost);
  const commentListing = data[1]?.data?.children ?? [];
  const comments = commentListing
    .filter((child): child is RdtListingChild<RawRdtComment> => child.kind === "t1")
    .map((child) => adaptComment(child.data, post.permalink))
    .filter((comment): comment is RedditComment => comment !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);

  return { post, comments };
}

async function runRdt<T>(args: readonly string[]): Promise<T> {
  let result: ExternalToolCommandResult;
  try {
    result = await commandRunner(RDT_BINARY, args);
  } catch (err) {
    const nodeError = err as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      throw new ExternalToolNotInstalled(RDT_BINARY, RDT_INSTALL_CMD);
    }
    throw new ExternalToolError(
      RDT_BINARY,
      redactSensitiveOutput(err instanceof Error ? err.message : String(err)),
    );
  }

  if (result.code !== 0) {
    const envelopeError = parseCliErrorEnvelope(result.stdout);
    if (envelopeError) {
      throw new ExternalToolError(
        RDT_BINARY,
        redactSensitiveOutput(envelopeError.message),
        envelopeError.code,
      );
    }
    throw new ExternalToolError(
      RDT_BINARY,
      redactSensitiveOutput(result.stderr.trim() || `rdt-cli exited with code ${result.code}`),
    );
  }

  let envelope: RdtEnvelope<T>;
  try {
    envelope = JSON.parse(result.stdout) as RdtEnvelope<T>;
  } catch {
    throw new ExternalToolError(
      RDT_BINARY,
      `rdt-cli returned non-JSON output: ${redactSensitiveOutput(result.stdout.slice(0, 200))}`,
    );
  }

  if (!envelope.ok) {
    throw new ExternalToolError(
      RDT_BINARY,
      redactSensitiveOutput(envelope.error?.message ?? "rdt-cli returned an error"),
      envelope.error?.code,
    );
  }
  if (envelope.data === undefined) {
    throw new ExternalToolError(RDT_BINARY, "rdt-cli returned no data");
  }
  return envelope.data;
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

function adaptPost(raw: RawRdtPost): RdtPost {
  const permalink = stringValue(raw.permalink);
  const url = stringValue(raw.url) || (permalink ? `https://reddit.com${permalink}` : "");
  return {
    id: stringValue(raw.id),
    title: stringValue(raw.title),
    selftext: stringValue(raw.selftext),
    author: stringValue(raw.author) || "unknown",
    score: numberValue(raw.score),
    comments: numberValue(raw.num_comments),
    subreddit: stringValue(raw.subreddit) || undefined,
    url,
    permalink: permalink || undefined,
    created: normalizeCreatedAt(raw.created_utc),
  };
}

function adaptComment(
  raw: RawRdtComment | undefined,
  postPermalink?: string,
): RedditComment | null {
  if (!raw || typeof raw.body !== "string" || raw.body.length === 0) return null;
  const permalink = stringValue(raw.permalink) || postPermalink || "";
  return {
    id: stringValue(raw.id),
    body: raw.body,
    author: stringValue(raw.author) || "unknown",
    score: numberValue(raw.score),
    permalink: permalink ? `https://reddit.com${permalink}` : "",
  };
}

function normalizeCreatedAt(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
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

export function redactSensitiveOutput(input: string): string {
  return input
    .slice(0, MAX_OUTPUT_CHARS)
    .replace(
      /\b([a-z0-9_]*(?:cookie|session|token)[a-z0-9_]*)\b\s*[:=]\s*[^;\s,)]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b([a-z0-9_]*(?:cookie|session|token)[a-z0-9_]*)=([^;\s,)]+)/gi, "$1=[redacted]")
    .replace(
      /(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/\.config\/rdt-cli\/credential\.json/g,
      "[redacted-credential-path]",
    );
}

function runCommand(command: string, args: readonly string[]): Promise<ExternalToolCommandResult> {
  return runExternalToolCommand(command, args, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxOutputChars: MAX_OUTPUT_CHARS,
  });
}
