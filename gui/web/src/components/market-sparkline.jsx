const WIDTH = 120;
const HEIGHT = 30;
const PADDING = 2;

export function MarketSparkline({ symbol, sparkline, className = "" }) {
  if (sparkline?.status !== "ok" || sparkline.points.length < 2) {
    return (
      <figure
        data-slot="market-sparkline"
        data-source={sparkline?.source ?? "Yahoo Finance"}
        className={`w-24 sm:w-[120px] ${className}`.trim()}
        title={sparkline?.reason ?? "Intraday history unavailable"}
      >
        <div className="flex h-[29px] items-center text-[10px] text-muted-foreground sm:h-9">
          Unavailable
        </div>
        <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
          Yahoo · unavailable
        </figcaption>
      </figure>
    );
  }

  const path = sparklinePath(sparkline.points);
  const rising = sparkline.points.at(-1) >= sparkline.points[0];
  const dataAsOf = sparkline.dataAsOf ?? "unknown";
  return (
    <figure
      data-slot="market-sparkline"
      data-source={sparkline.source}
      className={`w-24 sm:w-[120px] ${className}`.trim()}
    >
      <svg
        role="img"
        aria-label={`${symbol} intraday price sparkline from ${sparkline.source}, data as of ${dataAsOf}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`block h-[29px] w-24 overflow-visible sm:h-9 sm:w-[120px] ${
          rising ? "text-success" : "text-destructive"
        }`}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="truncate text-[10px] leading-4 tabular-nums text-muted-foreground">
        Yahoo · {dataAsOf}
      </figcaption>
    </figure>
  );
}

function sparklinePath(points) {
  const minimum = Math.min(...points);
  const maximum = Math.max(...points);
  const range = maximum - minimum || 1;
  return points
    .map((point, index) => {
      const x = PADDING + (index / (points.length - 1)) * (WIDTH - PADDING * 2);
      const y = PADDING + (1 - (point - minimum) / range) * (HEIGHT - PADDING * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
