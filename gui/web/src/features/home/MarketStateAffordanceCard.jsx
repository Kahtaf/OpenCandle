import { Panel } from "../market-state/shared.jsx";

const CONTENT = {
  watchlist: {
    title: "Add a watchlist",
    description: "Keep the tickers you follow close at hand and see the biggest daily moves.",
    href: "/watchlists",
    action: "Create watchlist",
  },
  portfolio: {
    title: "Track a portfolio",
    description: "Add your holdings to monitor total value, today’s move, and long-term P&L.",
    href: "/portfolios",
    action: "Add portfolio",
  },
};

export function MarketStateAffordanceCard({ kind }) {
  const content = CONTENT[kind];
  if (!content) return null;
  const headingId = `home-${kind}-affordance-heading`;

  return (
    <section aria-labelledby={headingId} data-slot={`home-${kind}-affordance`}>
      <Panel title={content.title} headingId={headingId}>
        <div className="flex min-h-[120px] flex-col items-start justify-center gap-3 p-4">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">{content.description}</p>
          <a
            href={content.href}
            className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-[background-color,border-color,transform,scale] duration-150 ease-out hover:bg-muted active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content.action}
          </a>
        </div>
      </Panel>
    </section>
  );
}
