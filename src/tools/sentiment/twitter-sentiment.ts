import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { promptUser } from "../../onboarding/prompt-user.js";
import { getProvider } from "../../onboarding/providers.js";
import {
  loadOnboardingState,
  markProviderNeverAsk,
  saveOnboardingState,
} from "../../onboarding/state.js";
import { buildExternalToolRequiredTag, buildSkippedTag } from "../../onboarding/tool-tags.js";
import { getTwitterSentiment } from "../../providers/twitter.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { TwitterAdapter } from "../../sentiment/adapters/twitter.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import type { AskUserHandler } from "../../types/index.js";
import type { TwitterSentimentResult } from "../../types/sentiment.js";
import { formatInsightSection } from "./insight-format.js";
import { renderUntrustedText, untrustedContentHeader } from "./untrusted-text.js";

const params = Type.Object({
  query: Type.String({
    description: "Stock ticker (e.g. AAPL) or search term (e.g. 'AAPL earnings call')",
  }),
  limit: Type.Optional(Type.Number({ description: "Max tweets to fetch. Default: 50, max: 200" })),
  hours: Type.Optional(Type.Number({ description: "Lookback window in hours. Default: 24" })),
});

const INSTALL_CONTINUE_LABEL = "Continue after installing twitter-cli";
const SESSION_CONTINUE_LABEL = "Continue after refreshing X/Twitter session";
const SKIP_ONCE_LABEL = "Skip X/Twitter once";
const ALWAYS_SKIP_LABEL = "Always skip X/Twitter";

interface TwitterSentimentToolOptions {
  askUserHandler?: AskUserHandler;
}

interface ExtensionContextWithAskUserHandler extends Partial<ExtensionContext> {
  askUserHandler?: AskUserHandler;
}

type TwitterUnavailableKind = "install" | "session" | "other";
type TwitterToolDetails = TwitterSentimentResult | null;

export function createTwitterSentimentTool(
  options: TwitterSentimentToolOptions = {},
): AgentTool<typeof params, TwitterToolDetails> {
  return {
    name: "get_twitter_sentiment",
    label: "Twitter Sentiment",
    description:
      "Fetch recent tweets for a stock ticker or search query and compute engagement-weighted sentiment. Returns tweet data, sentiment score, and co-mentioned tickers. Requires twitter-cli and a browser X/Twitter session.",
    parameters: params,
    async execute(_toolCallId, args, _signal, _onUpdate, ctx?: ExtensionContext) {
      const limit = Math.min(args.limit ?? 50, 200);
      const hours = args.hours ?? 24;
      const descriptor = getProvider("twitter");
      const state = loadOnboardingState();
      if (state.providers.twitter?.status === "never_ask") {
        return skippedResult(
          "You previously asked not to be reminded about X/Twitter.",
          true,
          "run opencandle doctor --enable twitter to re-enable X/Twitter sentiment (silenced)",
        );
      }

      const fetchTwitterSentiment = () =>
        wrapProvider("twitter", () => getTwitterSentiment(args.query, limit, hours));
      const providerResult = await fetchTwitterSentiment();

      if (providerResult.status === "unavailable") {
        const reason = providerResult.reason;
        const unavailableKind = classifyUnavailableReason(reason);
        const askUserHandler =
          options.askUserHandler ??
          (ctx as ExtensionContextWithAskUserHandler | undefined)?.askUserHandler;
        const canAsk = askUserHandler != null || ctx?.hasUI === true;

        if (unavailableKind !== "other" && canAsk) {
          const promptResult = await promptUser(
            (ctx ?? { hasUI: false }) as ExtensionContext,
            {
              question: setupQuestion(unavailableKind, reason),
              questionType: "select",
              options: [
                unavailableKind === "install" ? INSTALL_CONTINUE_LABEL : SESSION_CONTINUE_LABEL,
                SKIP_ONCE_LABEL,
                ALWAYS_SKIP_LABEL,
              ],
              reason:
                "X/Twitter sentiment needs the twitter-cli command and a browser session before it can fetch tweets.",
            },
            askUserHandler,
          );

          if (!promptResult.cancelled && promptResult.answer?.startsWith("Continue")) {
            const retried = await fetchTwitterSentiment();
            if (retried.status === "ok") {
              return formatTwitterSentimentResult(retried.data, args.query, hours, {
                stale: retried.stale,
                timestamp: retried.timestamp,
              });
            }
            return passiveUnavailableResult(
              retried.reason,
              classifyUnavailableReason(retried.reason),
              { interceptable: false },
            );
          }

          if (!promptResult.cancelled && promptResult.answer === ALWAYS_SKIP_LABEL) {
            saveOnboardingState(markProviderNeverAsk(state, "twitter"));
            return skippedResult(
              `User chose to always skip ${descriptor.displayName} data. Do not ask about X/Twitter setup again unless the user explicitly reconnects it.`,
              true,
              "run opencandle doctor --enable twitter to re-enable X/Twitter sentiment (silenced)",
            );
          }

          return skippedResult(
            `User chose to skip ${descriptor.displayName} data for this request. Do not ask about X/Twitter setup again in this turn.`,
            false,
            "user chose to skip X/Twitter for this request",
          );
        }

        return passiveUnavailableResult(reason, unavailableKind);
      }

      return formatTwitterSentimentResult(providerResult.data, args.query, hours, {
        stale: providerResult.stale,
        timestamp: providerResult.timestamp,
      });
    },
  };
}

export const twitterSentimentTool = createTwitterSentimentTool();

function classifyUnavailableReason(reason: string): TwitterUnavailableKind {
  if (reason.includes("not installed") || reason.includes("uv tool install")) return "install";
  if (/no twitter cookies|no cookies|401|unauthorized|expired|session/i.test(reason)) {
    return "session";
  }
  return "other";
}

function setupQuestion(kind: Exclude<TwitterUnavailableKind, "other">, reason: string): string {
  if (kind === "install") {
    return `X/Twitter sentiment requires twitter-cli. Install it with \`uv tool install twitter-cli\`, then choose whether to continue or skip X/Twitter. Current status: ${reason}`;
  }
  return `X/Twitter sentiment needs an active browser session. Log into or refresh x.com in a supported browser, then choose whether to continue or skip X/Twitter. Current status: ${reason}`;
}

function passiveUnavailableResult(
  reason: string,
  kind: TwitterUnavailableKind,
  options: { interceptable?: boolean } = {},
) {
  if ((options.interceptable ?? true) && (kind === "install" || kind === "session")) {
    const tag = buildExternalToolRequiredTag({
      provider: "twitter",
      reason:
        kind === "install"
          ? "not_installed"
          : /401|unauthorized|expired/i.test(reason)
            ? "session_stale"
            : "session_missing",
      installCmd: "uv tool install twitter-cli",
      loginCmd: "log into x.com in a supported browser",
      fallback: "reddit-web-news",
    });
    const guidance =
      kind === "install"
        ? "Twitter sentiment requires twitter-cli. Install it with `uv tool install twitter-cli`, then choose whether to continue or skip X/Twitter."
        : "Twitter sentiment requires an active X/Twitter browser session. Log into or refresh x.com in a supported browser, then retry after confirmation.";
    return {
      content: [
        {
          type: "text" as const,
          text: `⚠ Twitter sentiment unavailable: ${reason}\n${tag}\n${guidance}`,
        },
      ],
      details: null,
    };
  }
  const text = `⚠ Twitter sentiment unavailable (${reason}).`;
  return {
    content: [{ type: "text" as const, text }],
    details: null,
  };
}

function skippedResult(message: string, silenced: boolean, remediation: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${buildSkippedTag({
          provider: "twitter",
          reason: "credential_not_provided",
          remediation,
          silenced,
        })}\n\n${message}`,
      },
    ],
    details: null,
  };
}

async function formatTwitterSentimentResult(
  result: TwitterSentimentResult,
  query: string,
  hours: number,
  metadata: { stale?: boolean; timestamp: string },
) {
  const sentimentLabel =
    result.sentimentScore > 0.3
      ? "Bullish"
      : result.sentimentScore < -0.3
        ? "Bearish"
        : result.sentimentScore > 0
          ? "Leaning Bullish"
          : result.sentimentScore < 0
            ? "Leaning Bearish"
            : "Neutral";

  const lines = [
    `**Twitter: ${result.query}** — ${result.tweetCount} tweets (last ${hours}h, ${result.fetchedAt})`,
    `Sentiment: ${result.sentimentScore.toFixed(2)} (${sentimentLabel}) | Bullish: ${result.bullishCount} | Bearish: ${result.bearishCount}`,
  ];

  if (result.topMentions.length > 0) {
    lines.push(`Co-mentions: ${result.topMentions.map((t) => `$${t}`).join(", ")}`);
  }

  lines.push("");
  lines.push(untrustedContentHeader("tweets"));
  lines.push("| Author | Tweet | ❤️ | 🔁 | 💬 |");
  lines.push("|--------|-------|----|----|----|");
  const top = result.tweets.slice(0, 15);
  for (const tweet of top) {
    const text = renderUntrustedText(tweet.text, 100);
    lines.push(
      `| @${tweet.author} | ${text} | ${tweet.likes} | ${tweet.retweets} | ${tweet.replies} |`,
    );
  }

  if (metadata.stale) {
    lines.push("");
    lines.push(`⚠ Stale data (cached at ${metadata.timestamp})`);
  }

  let details: TwitterSentimentResult = result;

  // Index in sentiment store and append trend context
  try {
    const adapter = new TwitterAdapter();
    const records = adapter.mapToRecords(result, query);
    const pipeline = getSentimentPipeline();
    const pipelineResult = await pipeline.processRecords(records, query);
    if (pipelineResult.insight) {
      const insight = metadata.stale
        ? {
            ...pipelineResult.insight,
            caveats: [
              ...pipelineResult.insight.caveats,
              `Stale data cached at ${metadata.timestamp}.`,
            ],
          }
        : pipelineResult.insight;
      details = { ...result, insight };
      lines.push(...formatInsightSection(insight));
    }
    if (pipelineResult.trend && pipelineResult.trend.length > 0) {
      const t = pipelineResult.trend[0];
      lines.push("");
      lines.push(
        `Trend: ${t.sparkline} ${t.direction} (${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}, ${t.count} records)`,
      );
    }
  } catch {
    // Sentiment indexing is best-effort — don't fail the tool
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }], details };
}
