import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { cn } from "../../lib/utils.js";

// One height for the tinted top of every slide, so paging never resizes the
// dialog. The brand plate shares it with the artwork bands.
const PLATE_HEIGHT = "h-[196px] sm:h-[228px] [@media(min-height:880px)]:h-[256px]";

/**
 * Slide artwork.
 *
 * Each slide crops into one detail of the real product at close to its real
 * size, drawn directly onto a Zinc Mist band that bleeds to the dialog frame.
 * The rules that shape it:
 *
 * - No plate, no floating card. DESIGN.md bans nested rounded containers, and a
 *   small card centred in a large tint is what made this read as filler. The
 *   band IS the surface; hairline dividers and type do the structural work.
 * - Crop, don't shrink. A whole miniature screen at 40% is illegible; one
 *   fragment at full size reads as a window onto working software.
 * - Three different shapes. Slide one is a wide strip built on one oversized
 *   figure, slide two a dense status table, slide three two-line rows carrying
 *   sparkline graphics. Three identical centred compositions were the tell.
 *
 * Colour is only ever market direction or provider state, and every figure is
 * signed and tabular.
 *
 * There is no "Example" kicker. Nothing here is a claim OpenCandle is making
 * about a live market, and the way that is said is compositional rather than
 * written: every band runs past two of its own edges and fades there, so what
 * you see is plainly a fragment of an interface rather than a panel reporting a
 * current price. Do not put the label back; if this ever stops reading as
 * illustrative, change the drawing.
 */
function Band({ children, className, fadeRight, fadeBottom, fill }) {
  return (
    // The tint and the hairline live on the outer box so the scrims sit inside
    // the band without covering its own bottom border.
    <div aria-hidden="true" className="relative border-b border-border bg-secondary">
      <div className={cn(PLATE_HEIGHT, "overflow-hidden")}>
        <div
          className={cn(
            "px-7 pt-6 sm:px-8 sm:pt-7 [@media(min-height:880px)]:pt-8",
            // `fill` is for artwork shorter than the band: it becomes a column
            // that owns the full height, so a child can take `mt-auto` and hold
            // the bottom edge instead of leaving the band half empty as the
            // viewport grows.
            fill && "h-full pb-6 sm:pb-7 [@media(min-height:880px)]:pb-8",
          )}
        >
          {/* Bleeds past the right edge: the frame does the cropping. */}
          <div className={cn("w-[calc(100%+40px)]", fill && "flex h-full flex-col", className)}>
            {children}
          </div>
        </div>
      </div>
      {fadeRight ? (
        <span
          className={cn(EDGE_SCRIM, "inset-y-0 right-0 w-20 bg-gradient-to-l from-secondary")}
        />
      ) : null}
      {fadeBottom ? (
        <span
          className={cn(EDGE_SCRIM, "inset-x-0 bottom-0 h-9 bg-gradient-to-t from-secondary")}
        />
      ) : null}
    </div>
  );
}

const RAIL = "text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

// The dialog's close control floats over the top right of the band, 44px wide
// and 12px in. Right-hand columns reserve at least that much so no row ever
// runs under the X, easing off on a card too narrow to spare it.
const CLOSE_CLEARANCE = "pr-20 min-[400px]:pr-24";

// Scrims in the band's own surface colour, sitting at the edge the content runs
// past. A crop that fades reads as composition; a hard cut through a letterform
// reads as an overflow bug, and where the cut lands depends on the width.
//
// A scrim rather than a `mask-image`: the bands live inside embla's translated
// track, and a masked element there gets its own composited layer that renders
// at a stale offset mid-transition.
const EDGE_SCRIM = "pointer-events-none absolute z-10";

/**
 * The opening slide is a brand plate, not a fourth artwork band: no crop, no
 * fade, no hairline table. Just the lockup, centred and unhurried, on the same
 * tint and at the same height as the bands that follow, so the deck opens on a
 * held note and then gets to work.
 */
function BrandPlate() {
  return (
    <div
      className={cn(
        PLATE_HEIGHT,
        "flex items-center justify-center border-b border-border bg-secondary px-8",
      )}
    >
      <div className="flex items-center gap-3.5">
        {/* Here the mark carries the accessible name and the wordmark beside it
            is the visual half of the same lockup, so it is hidden from the
            reading order rather than announced twice. */}
        <OpenCandleLogo label="OpenCandle" className="size-11 sm:size-[52px]" />
        <span
          aria-hidden="true"
          className="text-[28px] font-semibold tracking-tight text-foreground sm:text-[34px]"
        >
          OpenCandle
        </span>
      </div>
    </div>
  );
}

/**
 * Slide 1: one oversized signed figure with its receipt underneath. The scale
 * jump from 40px to 10px is the focal point, and the evidence rail runs off the
 * right edge because there is always more of it.
 */
function AuditedAnswerBand() {
  return (
    <Band fadeRight fill>
      <div className="flex items-end gap-4">
        <div>
          <div className="text-[12px] font-semibold leading-4 tracking-tight text-foreground">
            NVDA
          </div>
          <div className="text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] tabular-nums text-success sm:text-[52px] [@media(min-height:880px)]:text-[60px]">
            +2.41%
          </div>
        </div>
        {/* Secondary figures go first on a card too narrow to hold them
            clear of the close control. The headline figure carries the slide. */}
        <div className="hidden pb-2 text-[12px] leading-[1.45] text-muted-foreground min-[400px]:block">
          <div className="tabular-nums text-foreground">141.22</div>
          <div className="tabular-nums">2.1× 30-day volume</div>
        </div>
      </div>
      {/* The session line takes whatever height is left between the figure and
          its receipt, so a taller band gets a taller chart rather than a hole in
          the middle of the composition. */}
      <Sparkline
        points="0,17 8,15 16,16 24,11 32,12 40,13 48,8 56,9 64,3"
        className="mt-3 h-auto w-[78%] min-h-[24px] flex-1 text-success/70"
      />
      {/* `outline` rather than the default tint: these chips sit on Zinc Mist,
          where a Zinc Mist chip disappears.

          The rail is longer than the frame (there is always more evidence) and
          its trailing edge fades. A hard cut lands mid-glyph at some widths,
          which reads as an overflow bug; a fade reads as composition at every
          width. */}
      {/* `mt-auto`: the receipt holds the bottom of the band, so the figure and
          its evidence sit at opposite edges however tall the band gets. */}
      <div className="mt-auto pt-4">
        <div className="flex flex-nowrap items-center gap-1.5 border-t border-hard pt-3">
          <span className={cn(RAIL, "shrink-0")}>Evidence</span>
          {[
            "get_stock_quote",
            "Yahoo Finance",
            "get_stock_history",
            "get_technical_indicators",
          ].map((source) => (
            <Badge key={source} size="sm" variant="outline" className="shrink-0">
              {source}
            </Badge>
          ))}
        </div>
        <p className="m-0 mt-2.5 text-[11px] leading-4 text-muted-foreground">
          As of 3:42pm ET · Yahoo Finance
        </p>
      </div>
    </Band>
  );
}

/**
 * Slide 2: a dense readiness table that runs off the bottom and the right of
 * the frame. The one amber caveat is the thing worth a second look, and it is
 * exactly how the product reports degraded data.
 */
function SourceReadinessBand() {
  const rows = [
    { label: "Yahoo Finance", detail: "Quotes · history · options" },
    { label: "SEC EDGAR", detail: "Filings · 10-K, 10-Q, 8-K" },
    { label: "FRED", detail: "Macro series" },
    { label: "Alpha Vantage", detail: "Fundamentals", stale: "Quote 26m old" },
    { label: "CoinGecko", detail: "Crypto quotes" },
    { label: "Polymarket", detail: "Event probabilities" },
    { label: "Finnhub", detail: "Company news" },
    { label: "TradingView", detail: "Screener · breadth" },
  ];
  return (
    <Band fadeBottom fadeRight>
      <div className="border-t border-hard">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center gap-2 border-b border-border py-[7px] text-[12px] leading-[18px]"
          >
            <span className="w-[100px] shrink-0 truncate font-medium text-foreground">
              {row.label}
            </span>
            {/* Same reason as the watchlist rows: on a narrow card this column
                would run under the close control rather than truncate, because
                the status cell beside it cannot shrink. */}
            <span className="hidden min-w-0 truncate text-muted-foreground min-[400px]:inline">
              {row.detail}
            </span>
            <span className={cn("ml-auto flex shrink-0 items-center", CLOSE_CLEARANCE)}>
              {row.stale ? (
                <Badge size="sm" variant="warning">
                  {row.stale}
                </Badge>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-[6px] rounded-full bg-success" />
                  Ready
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Band>
  );
}

// Sparklines are drawn from a normalised point list so the shape is stable and
// the stroke inherits its direction colour from the row. No chart library, no
// asset: the same inline form the watchlist rows use.
function Sparkline({ points, className }) {
  return (
    <svg
      viewBox="0 0 64 20"
      preserveAspectRatio="none"
      className={cn("h-5 w-16 shrink-0 overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Slide 3: two-line rows at close to real size, carrying the sparkline the
 * watchlist actually renders. Graphic texture rather than more type, and the
 * list is cut off at the bottom so it clearly continues.
 */
function LocalDeskBand() {
  const rows = [
    {
      symbol: "NVDA",
      name: "NVIDIA Corp. · Nasdaq",
      last: "141.22",
      change: "+2.41%",
      tone: "text-success",
      points: "0,16 9,14 18,15 27,10 36,11 45,6 54,7 64,2",
    },
    {
      symbol: "AAPL",
      name: "Apple Inc. · Nasdaq",
      last: "232.14",
      change: "+0.62%",
      tone: "text-success",
      points: "0,13 9,15 18,11 27,12 36,8 45,10 54,6 64,7",
    },
    {
      symbol: "MSFT",
      name: "Microsoft Corp. · Nasdaq",
      last: "418.90",
      change: "−0.31%",
      tone: "text-destructive",
      points: "0,6 9,8 18,7 27,11 36,10 45,13 54,12 64,15",
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices · Nasdaq",
      last: "163.05",
      change: "+1.18%",
      tone: "text-success",
      points: "0,15 9,12 18,13 27,9 36,10 45,8 54,5 64,6",
    },
    {
      symbol: "GOOGL",
      name: "Alphabet Inc. · Nasdaq",
      last: "196.44",
      change: "−0.74%",
      tone: "text-destructive",
      points: "0,7 9,6 18,9 27,8 36,12 45,11 54,14 64,16",
    },
    {
      symbol: "AVGO",
      name: "Broadcom Inc. · Nasdaq",
      last: "284.11",
      change: "+0.94%",
      tone: "text-success",
      points: "0,14 9,13 18,10 27,11 36,7 45,9 54,4 64,5",
    },
  ];
  return (
    <Band fadeBottom fadeRight>
      <div className="border-t border-hard">
        {rows.map((row) => (
          <div key={row.symbol} className="border-b border-border py-2">
            <div className="flex items-center gap-3">
              <span className="w-[52px] shrink-0 text-[13px] font-semibold leading-4 tracking-tight text-foreground">
                {row.symbol}
              </span>
              <Sparkline points={row.points} className={row.tone} />
              {/* The last-trade column is the first thing to go on a narrow
                  card: every cell here is `shrink-0`, so keeping it would push
                  the change column out under the dialog's close control. */}
              <span className="ml-auto hidden shrink-0 text-[13px] leading-4 tabular-nums text-foreground min-[400px]:block">
                {row.last}
              </span>
              <span
                className={cn(
                  "ml-auto w-[124px] shrink-0 text-right text-[13px] font-medium leading-4 tabular-nums min-[400px]:ml-0 min-[400px]:w-[152px]",
                  CLOSE_CLEARANCE,
                  row.tone,
                )}
              >
                {row.change}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
              {row.name}
            </div>
          </div>
        ))}
      </div>
    </Band>
  );
}

export const ONBOARDING_INTRO_STEPS = [
  {
    id: "welcome",
    title: "Market research, on your machine",
    body: "OpenCandle is a research agent for investors and market researchers. It reads live quotes, filings and macro data, then shows its working.",
    Visual: BrandPlate,
    // The brand moment is composed on one axis; the explainers that follow keep
    // the deck's left spine.
    centered: true,
  },
  {
    id: "audited-answers",
    title: "Answers you can check",
    body: "OpenCandle gathers market data before it answers, then shows the tools and sources it used. Check the work yourself.",
    Visual: AuditedAnswerBand,
  },
  {
    id: "live-evidence",
    title: "Evidence from live sources",
    body: "Quotes, filings, options chains, macro series and sentiment come from real providers. Missing or stale data is disclosed, never filled in.",
    Visual: SourceReadinessBand,
  },
  {
    id: "local-desk",
    title: "Your research desk stays yours",
    body: "Watchlists, portfolios, alerts and sessions stay on this device. OpenCandle places no trades and gives no financial advice.",
    Visual: LocalDeskBand,
  },
];
