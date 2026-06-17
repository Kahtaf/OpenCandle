import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { promptUser } from "../../onboarding/prompt-user.js";
import { getProvider } from "../../onboarding/providers.js";
import {
  loadOnboardingState,
  markProviderNeverAsk,
  saveOnboardingState,
} from "../../onboarding/state.js";
import { buildExternalToolRequiredTag, buildSkippedTag } from "../../onboarding/tool-tags.js";
import { getPostComments, getSubredditPosts } from "../../providers/reddit.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { RedditAdapter } from "../../sentiment/adapters/reddit.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import type { AskUserHandler } from "../../types/index.js";
import type { RedditSentimentResult } from "../../types/sentiment.js";
import { formatInsightSection } from "./insight-format.js";
import { recordMatchesSentimentQuery, sentimentQueryTerms } from "./query-match.js";
import { renderUntrustedText, untrustedContentHeader } from "./untrusted-text.js";

const params = Type.Object({
  subreddit: Type.Optional(
    Type.String({
      description:
        "Subreddit name (e.g. wallstreetbets, stocks). If omitted, searches across default subreddits.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Topic or ticker to filter posts by (e.g. AAPL, bitcoin). Searches titles and post bodies.",
    }),
  ),
  subreddits: Type.Optional(
    Type.Array(Type.String(), {
      description: "Multiple subreddits to search. Overrides single subreddit param.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Number of posts per subreddit. Default: 25, max: 100" }),
  ),
});

const INSTALL_CONTINUE_LABEL = "Continue after installing Reddit";
const SESSION_CONTINUE_LABEL = "Continue after logging in to Reddit";
const SKIP_ONCE_LABEL = "Skip Reddit once";
const ALWAYS_SKIP_LABEL = "Always skip Reddit";

interface ExtensionContextWithAskUserHandler extends Partial<ExtensionContext> {
  askUserHandler?: AskUserHandler;
}

interface RedditSentimentToolOptions {
  askUserHandler?: AskUserHandler;
}

type RedditToolDetails = RedditSentimentResult | null;

export function createRedditSentimentTool(
  options: RedditSentimentToolOptions = {},
): AgentTool<typeof params, RedditToolDetails> {
  return {
    name: "get_reddit_sentiment",
    label: "Reddit Sentiment",
    description:
      "Analyze sentiment from financial Reddit communities. Supports single subreddit, multi-subreddit, and topic filtering. Returns scored posts with comment analysis and trend context.",
    parameters: params,
    async execute(_toolCallId, args, _signal, _onUpdate, ctx?: ExtensionContext) {
      const limit = Math.min(args.limit ?? 25, 100);
      const config = getConfig();
      const state = loadOnboardingState();
      const descriptor = getProvider("reddit");
      if (state.providers.reddit?.status === "never_ask") {
        return skippedRedditResult(
          "You previously asked not to be reminded about Reddit.",
          "run opencandle doctor --enable reddit to re-enable Reddit sentiment (silenced)",
          true,
        );
      }

      // Determine subreddits to search
      let subreddits: string[];
      if (args.subreddits && args.subreddits.length > 0) {
        subreddits = args.subreddits;
      } else if (args.subreddit) {
        subreddits = [args.subreddit];
      } else {
        subreddits = config.sentiment?.defaultSubreddits ?? [
          "wallstreetbets",
          "stocks",
          "investing",
          "options",
        ];
      }

      let { allResults, warnings } = await fetchRedditSubreddits(subreddits, limit, args.query);
      let retriedAfterContinue = false;
      let promptedSetupIssue: ReturnType<typeof classifyRedditSetupIssue> = null;

      if (allResults.length === 0) {
        const setupIssue = classifyRedditSetupIssue(warnings);
        if (setupIssue) {
          promptedSetupIssue = setupIssue;
          const askUserHandler =
            options.askUserHandler ??
            (ctx as ExtensionContextWithAskUserHandler | undefined)?.askUserHandler;
          const canAsk = askUserHandler != null || ctx?.hasUI === true;
          if (canAsk) {
            const promptResult = await promptUser(
              (ctx ?? { hasUI: false }) as ExtensionContext,
              {
                question:
                  setupIssue === "not_installed"
                    ? "Reddit sentiment needs the local rdt-cli command before it can fetch discussions. Install command: uv tool install rdt-cli. How would you like to proceed?"
                    : "Reddit sentiment needs an active Reddit browser session for rdt-cli. Login command: rdt login. How would you like to proceed?",
                questionType: "select",
                options: [
                  setupIssue === "not_installed" ? INSTALL_CONTINUE_LABEL : SESSION_CONTINUE_LABEL,
                  SKIP_ONCE_LABEL,
                  ALWAYS_SKIP_LABEL,
                ],
                reason: "Reddit sentiment needs rdt-cli and a Reddit browser session.",
              },
              askUserHandler,
            );

            if (!promptResult.cancelled && promptResult.answer?.startsWith("Continue")) {
              retriedAfterContinue = true;
              ({ allResults, warnings } = await fetchRedditSubreddits(
                subreddits,
                limit,
                args.query,
              ));
            } else if (!promptResult.cancelled && promptResult.answer === ALWAYS_SKIP_LABEL) {
              saveOnboardingState(markProviderNeverAsk(state, "reddit"));
              return skippedRedditResult(
                `User chose to always skip ${descriptor.displayName} data. Do not ask about Reddit setup again unless the user explicitly re-enables it.`,
                "run opencandle doctor --enable reddit to re-enable Reddit sentiment (silenced)",
                true,
              );
            } else {
              return skippedRedditResult(
                `User chose to skip ${descriptor.displayName} data for this request. Do not ask about Reddit setup again in this turn.`,
                "user chose to skip Reddit for this request",
                false,
              );
            }
          }
        }
      }

      if (allResults.length === 0) {
        const setupIssue = classifyRedditSetupIssue(warnings);
        if (retriedAfterContinue && (!setupIssue || setupIssue === promptedSetupIssue)) {
          return unavailableRedditResult(warnings);
        }
        if (setupIssue) {
          const tag = buildExternalToolRequiredTag({
            provider: "reddit",
            reason: setupIssue,
            installCmd: "uv tool install rdt-cli",
            loginCmd: "rdt login",
            fallback: "twitter-web-news",
          });
          const guidance =
            setupIssue === "not_installed"
              ? "Reddit sentiment requires the local rdt-cli tool. Install it with `uv tool install rdt-cli`, then run `rdt login` if needed."
              : "Reddit sentiment requires an active Reddit browser session for rdt-cli. Run `rdt login` or refresh your Reddit browser login.";
          return {
            content: [{ type: "text", text: `${tag}\n\n${guidance}` }],
            details: null,
          };
        }
        return unavailableRedditResult(warnings);
      }

      // Merge records returned by the provider. rdt-cli handles query-bearing
      // requests server-side; the local filter remains a defensive post-filter.
      const adapter = new RedditAdapter();
      let allRecords = allResults.flatMap((r) =>
        adapter.mapPostsToRecords(r, args.query ?? subreddits.join("+")),
      );
      const queryTerms = args.query ? sentimentQueryTerms(args.query) : null;

      // Topic filtering
      if (queryTerms) {
        allRecords = allRecords.filter((record) => recordMatchesSentimentQuery(record, queryTerms));
      }

      // Deduplicate by sourceId (crossposts)
      const seen = new Set<string>();
      allRecords = allRecords.filter((r) => {
        if (seen.has(r.sourceId)) return false;
        seen.add(r.sourceId);
        return true;
      });

      // Fetch comments for top 10 posts by engagement
      const commentsPerPost = config.sentiment?.commentsPerPost ?? 5;
      const topPosts = [...allRecords]
        .sort((a, b) => b.engagement.score - a.engagement.score)
        .slice(0, 10);

      for (const post of topPosts) {
        const sub = (post.metadata.subreddit as string) ?? subreddits[0];
        if ((post.engagement.replies ?? 0) === 0) continue;
        try {
          const comments = await getPostComments(sub, post.sourceId, commentsPerPost);
          const commentRecords = adapter.mapCommentsToRecords(
            comments,
            post.sourceId,
            sub,
            args.query ?? subreddits.join("+"),
          );
          allRecords.push(
            ...(queryTerms
              ? commentRecords.filter((record) => recordMatchesSentimentQuery(record, queryTerms))
              : commentRecords),
          );
        } catch {
          // Comment fetch failures are non-fatal
        }
      }

      // Process through pipeline
      const pipeline = getSentimentPipeline();
      const pipelineResult = await pipeline.processRecords(
        allRecords,
        args.query ?? subreddits.join("+"),
      );

      // Build output using first result as base for backward compatibility
      const firstResult = allResults[0];
      const postRecords = pipelineResult.fresh.filter((r) => !r.metadata.isComment);
      const commentRecords = pipelineResult.fresh.filter((r) => r.metadata.isComment);
      const sentimentRecords = pipelineResult.fresh;
      const rawPostsById = new Map(
        allResults.flatMap((result) => result.posts.map((post) => [post.id, post] as const)),
      );
      const aggregatePosts: RedditSentimentResult["posts"] = postRecords.map((record) => {
        const rawPost = rawPostsById.get(record.sourceId);
        return {
          id: record.sourceId,
          title: rawPost?.title ?? record.title ?? "",
          selftext: rawPost?.selftext ?? "",
          author: rawPost?.author ?? record.author ?? "unknown",
          score: rawPost?.score ?? record.engagement.score,
          comments: rawPost?.comments ?? record.engagement.replies ?? 0,
          url: rawPost?.url ?? record.url,
          created: rawPost?.created ?? record.publishedAt ?? record.fetchedAt,
        };
      });
      const aggregateTopMentions = [
        ...new Set(postRecords.flatMap((record) => record.sentiment.tickers)),
      ];
      const avgScore =
        sentimentRecords.length > 0
          ? sentimentRecords.reduce((s, r) => s + r.sentiment.score, 0) / sentimentRecords.length
          : 0;

      const sentimentLabel =
        avgScore > 0.3
          ? "Bullish"
          : avgScore < -0.3
            ? "Bearish"
            : avgScore > 0
              ? "Leaning Bullish"
              : avgScore < 0
                ? "Leaning Bearish"
                : "Neutral";

      const subLabel =
        subreddits.length === 1 ? `r/${subreddits[0]}` : `${subreddits.length} subreddits`;
      const lines = [
        `**Reddit: ${args.query ?? subLabel}** — ${postRecords.length} posts, ${commentRecords.length} comments`,
        `Sentiment: ${avgScore.toFixed(2)} (${sentimentLabel})`,
      ];

      const details: RedditSentimentResult = {
        ...firstResult,
        subreddit: subreddits.length === 1 ? firstResult.subreddit : subreddits.join(","),
        postCount: postRecords.length,
        posts: aggregatePosts,
        topMentions: aggregateTopMentions,
        sentimentScore: avgScore,
        bullishCount: sentimentRecords.filter((record) => record.sentiment.score > 0).length,
        bearishCount: sentimentRecords.filter((record) => record.sentiment.score < 0).length,
        insight: pipelineResult.insight,
        records: pipelineResult.fresh,
      };

      if (pipelineResult.insight) {
        lines.push(...formatInsightSection(pipelineResult.insight));
      }

      if (aggregateTopMentions.length > 0) {
        lines.push(`Tickers: ${aggregateTopMentions.map((t) => `$${t}`).join(", ")}`);
      }

      lines.push("");
      lines.push(untrustedContentHeader("Reddit posts"));
      for (const post of postRecords.slice(0, 10)) {
        const scoreIndicator =
          post.sentiment.score > 0 ? "🟢" : post.sentiment.score < 0 ? "🔴" : "⚪";
        lines.push(
          `  ${scoreIndicator} ⬆${post.engagement.score} 💬${post.engagement.replies ?? 0} — ${renderUntrustedText(post.title ?? post.text, 100)}`,
        );
      }

      if (pipelineResult.trend && pipelineResult.trend.length > 0) {
        const t = pipelineResult.trend[0];
        lines.push("");
        lines.push(
          `Trend: ${t.sparkline} ${t.direction} (${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}, ${t.count} records)`,
        );
      }

      if (warnings.length > 0) {
        lines.push("");
        lines.push(`⚠ ${warnings.join("; ")}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], details };
    },
  };
}

export const redditSentimentTool = createRedditSentimentTool();

function unavailableRedditResult(warnings: readonly string[]): {
  content: [{ type: "text"; text: string }];
  details: null;
} {
  return {
    content: [{ type: "text", text: `⚠ Reddit sentiment unavailable (${warnings.join("; ")}).` }],
    details: null,
  };
}

async function fetchRedditSubreddits(
  subreddits: readonly string[],
  limit: number,
  query: string | undefined,
): Promise<{ allResults: RedditSentimentResult[]; warnings: string[] }> {
  const allResults: RedditSentimentResult[] = [];
  const warnings: string[] = [];
  for (const sub of subreddits) {
    const providerResult = await wrapProvider("reddit", () => getSubredditPosts(sub, limit, query));
    if (providerResult.status === "unavailable") {
      warnings.push(`r/${sub}: ${providerResult.reason}`);
      continue;
    }
    allResults.push(providerResult.data);
  }
  return { allResults, warnings };
}

function skippedRedditResult(
  message: string,
  remediation: string,
  silenced: boolean,
): { content: [{ type: "text"; text: string }]; details: null } {
  return {
    content: [
      {
        type: "text",
        text: `${buildSkippedTag({
          provider: "reddit",
          reason: "credential_not_provided",
          remediation,
          silenced,
        })}\n\n${message}`,
      },
    ],
    details: null,
  };
}

function classifyRedditSetupIssue(
  warnings: readonly string[],
): "not_installed" | "session_missing" | "session_stale" | null {
  const combined = warnings.join("\n").toLowerCase();
  if (combined.includes("not installed") || combined.includes("enoent")) {
    return "not_installed";
  }
  if (
    combined.includes("no reddit cookies") ||
    combined.includes("not authenticated") ||
    combined.includes("rdt login")
  ) {
    return "session_missing";
  }
  if (
    combined.includes("401") ||
    combined.includes("unauthorized") ||
    combined.includes("expired")
  ) {
    return "session_stale";
  }
  return null;
}
