# Design: Reddit via rdt-cli

## Goals

- Make Reddit sentiment work again without relying on Reddit's unauthenticated public `.json` endpoints.
- Reuse the proven external-tool provider pattern from the Twitter CLI migration.
- Preserve existing sentiment pipeline contracts so Reddit posts/comments still feed scoring, trends, insights, GUI cards, and final synthesis.
- Keep browser-cookie access explicit, local, and redacted.

## Non-Goals

- Do not implement official Reddit OAuth in this change.
- Do not build a new Reddit scraper inside OpenCandle.
- Do not ask users to paste Reddit cookies.
- Do not make OpenCandle manage or store `rdt-cli` credential files.
- Do not claim Reddit access is guaranteed; `rdt-cli` remains a best-effort local external tool.

## Provider Contract

Use a wrapper module, tentatively `src/providers/reddit-cli.ts`, that exposes typed functions such as:

```ts
interface RdtEnvelope<T> {
  ok: boolean;
  schema_version: string;
  data?: T;
  error?: { code?: string; message?: string };
}

export async function searchRedditPosts(query: string, opts: {
  subreddit?: string;
  rdtPath?: string;
  limit: number;
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
}): Promise<RdtPost[]>;

export async function listSubredditPosts(subreddit: string, opts: {
  rdtPath?: string;
  limit: number;
  sort?: "hot" | "new" | "top" | "rising" | "controversial" | "best";
  time?: "hour" | "day" | "week" | "month" | "year" | "all";
}): Promise<RdtPost[]>;

export async function readRedditPost(postId: string, opts: {
  rdtPath?: string;
  limit: number;
  sort?: "best" | "top" | "new" | "controversial" | "old" | "qa";
}): Promise<{ post: RdtPost; comments: RdtComment[] }>;
```

`getSubredditPosts()` and `getPostComments()` can remain as public provider APIs to reduce churn, but their implementation should call the wrapper instead of `httpGet("https://www.reddit.com/...json")`.

## Normalization

Map `rdt search` and `rdt sub` compact posts into the existing `RedditSentimentResult.posts[]` shape:

| Existing field | rdt source |
|---|---|
| `id` | `id` |
| `title` | `title` |
| `selftext` | `selftext ?? ""` |
| `author` | `author ?? "unknown"` |
| `score` | `score ?? 0` |
| `comments` | `num_comments ?? 0` |
| `url` | `url` or `https://reddit.com${permalink}` |
| `created` | `new Date(created_utc * 1000).toISOString()` |

Map `rdt read` comment listing children where `kind === "t1"` into `RedditComment`:

| Existing field | rdt source |
|---|---|
| `id` | `data.id` |
| `body` | `data.body ?? ""` |
| `author` | `data.author ?? "unknown"` |
| `score` | `data.score ?? 0` |
| `permalink` | `https://reddit.com${data.permalink ?? post.permalink ?? ""}` |

## Search Strategy

Current Reddit sentiment fetches hot posts and then filters locally by query. `rdt-cli` can search directly, so the new behavior should prefer server-side search when `query` is present:

- if `query` and one subreddit: `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>`
- if `query` and multiple subreddits: run one search per subreddit, then dedupe by `id`
- if no `query`: run `rdt sub <subreddit> --json --compact -n <limit>`

`rdt search --help` in `rdt` 0.4.1 confirms `-r, --subreddit TEXT`; implementation and tests should use the long `--subreddit` form for readability.

This is a functional improvement: Reddit sentiment should no longer miss older but highly relevant ticker discussions just because they are not currently hot.

## Error Handling

Use typed external-tool errors rather than `ProviderCredentialError`:

- `ExternalToolNotInstalled("rdt", "uv tool install rdt-cli")`
- missing session or unauthenticated status
- stale/rejected session
- non-zero exit
- malformed JSON
- successful envelope with `ok: false`
- empty data when the query should have results

`wrapProvider("reddit", ...)` can still classify the provider as unavailable for sentiment summary, but setup interception should key on typed external-tool failures where possible.

## Provider Status

Reddit provider status should have two modes:

- `install`: passive, runs `rdt --version`, does not read browser cookies.
- `session`: explicit, runs `rdt status`, may read browser-derived credentials or browser cookies.

The GUI provider row should not poll `rdt status` automatically. It may poll `rdt --version` while the setup drawer is open.

## Security

- Redact cookie-looking strings and paths before logs or UI display.
- Do not include `~/.config/rdt-cli/credential.json` contents in OpenCandle memory, traces, fixtures, screenshots, PR comments, or bug reports.
- Treat `rdt-cli` credential files as user-owned external state.
- Prefer process arguments arrays; never compose shell strings with user query text.

## Testing Strategy

- Fixtures for:
  - `rdt search --json --compact`
  - `rdt sub --json --compact`
  - `rdt read --json`
  - `rdt status` authenticated, unauthenticated, and error states
- Unit tests for:
  - adapter normalization
  - missing binary
  - non-zero exit and stderr redaction
  - malformed JSON
  - session missing/stale classification
  - multi-subreddit dedupe
  - comment mapping and partial comment failures
- Runtime proof before push:
  - TUI harness prompt that calls Reddit sentiment and includes comment/post rationale
  - GUI prompt showing Reddit tool call, GUI card, and final synthesis
  - sentiment summary prompt where Reddit works alongside Twitter and web

CI should not require a real authenticated Reddit browser session. CI-safe tests should inject or prepend a fixture-backed `rdt` executable through the wrapper's spawn boundary and assert the same command arguments, envelope parsing, `ask_user` flows, and final synthesis behavior. Local live proof before push should use the real `rdt-cli` binary and an authenticated session.

Always-skip state should be stored in OpenCandle provider setup/preferences state, not inside `rdt-cli`. The same provider setup surface and `opencandle doctor` flow that records the skip should offer a re-enable action.
