export interface FearGreedData {
  value: number;
  label: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: number;
  previousClose: number;
  weekAgo: number | null;
  monthAgo: number | null;
}

export interface RedditSentimentResult {
  subreddit: string;
  postCount: number;
  posts: Array<{
    title: string;
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
