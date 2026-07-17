// Fast, keyless prompts lead; /analyze is the deep-research option and is
// labeled as the longer multi-analyst run it is.
export const DEFAULT_PROMPTS = [
  ["What is NVDA trading at?", "What is NVDA trading at?"],
  ["Compare NVDA and AMD", "Compare NVDA and AMD using latest quotes."],
  ["Options chain for NVDA", "Show options chain for NVDA"],
  ["Deep research: NVDA (multi-analyst, takes a few minutes)", "/analyze NVDA"],
];

export function homePromptsForMarketState({
  watchlists = [],
  watchlistItems = [],
  portfolios = [],
  portfolioLots = [],
} = {}) {
  const watchlist = namedCollectionWithItems(watchlists, watchlistItems, "watchlistId");
  const portfolio = namedCollectionWithItems(portfolios, portfolioLots, "portfolioId");
  const prompts = [];

  if (watchlist) {
    prompts.push(
      isDefaultCollection(watchlist)
        ? ["What's moving in my watchlist?", "What's moving in my watchlist?"]
        : [
            `What's moving in ${watchlist.name}?`,
            `What's moving in my ${watchlist.name} watchlist?`,
          ],
    );
  }
  if (portfolio) {
    prompts.push(
      isDefaultCollection(portfolio)
        ? ["How is my portfolio doing?", "How is my portfolio doing?"]
        : [`How is ${portfolio.name} doing?`, `How is my ${portfolio.name} portfolio doing?`],
    );
  }
  return prompts.length > 0 ? prompts : DEFAULT_PROMPTS;
}

function isDefaultCollection(collection) {
  return (
    String(collection?.name ?? "")
      .trim()
      .toLowerCase() === "default"
  );
}

function namedCollectionWithItems(collections, items, collectionId) {
  const idsWithItems = new Set(items.map((item) => String(item?.[collectionId] ?? "")));
  return collections.find((collection) => {
    const name = String(collection?.name ?? "").trim();
    return name && idsWithItems.has(String(collection?.id ?? ""));
  });
}
