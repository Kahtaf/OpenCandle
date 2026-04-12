export interface FearGreedData {
  value: number;
  label: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: number;
  previousClose: number;
  weekAgo: number | null;
  monthAgo: number | null;
}

export interface TwitterTweet {
  id: string;
  text: string;
  author: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  url: string;
  created: string;
}

export interface TwitterSentimentResult {
  query: string;
  tweetCount: number;
  tweets: TwitterTweet[];
  sentimentScore: number;   // -1.0 (fully bearish) to +1.0 (fully bullish)
  bullishCount: number;
  bearishCount: number;
  topMentions: string[];
  fetchedAt: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Domain extracted from url (e.g., "reuters.com") */
  source: string;
  /** ISO 8601 timestamp, null if unknown */
  published: string | null;
  category: "news" | "general";
}

export interface WebSearchEnvelope {
  query: string;
  results: WebSearchResult[];
  resultCount: number;
  fetchedAt: string;
  provider: "ddg" | "brave" | "exa";
}

export interface RedditSentimentResult {
  subreddit: string;
  postCount: number;
  posts: Array<{
    id: string;
    title: string;
    selftext: string;
    author: string;
    score: number;
    comments: number;
    url: string;
    created: string;
  }>;
  topMentions: string[];
  sentimentScore: number;   // -1.0 (fully bearish) to +1.0 (fully bullish)
  bullishCount: number;
  bearishCount: number;
  fetchedAt: string;
}
