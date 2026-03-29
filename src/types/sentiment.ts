export interface FearGreedData {
  value: number;
  label: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: number;
  previousClose: number;
  weekAgo: number;
  monthAgo: number;
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
  fetchedAt: string;
}
