import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import { formatMoney, formatPercent } from "../lib/financial-format.js";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart.jsx";

const ALLOCATION_COLORS = [
  "hsl(var(--tw-info))",
  "hsl(var(--tw-success))",
  "hsl(var(--tw-warning))",
  "hsl(var(--tw-destructive))",
  "hsl(var(--tw-foreground))",
  "hsl(var(--tw-hard))",
];

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event) => setReduced(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

export default function AllocationDonut({ segments, totalValue, currency = "USD", className }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const data = useMemo(
    () =>
      (segments ?? [])
        .filter((segment) => Number.isFinite(segment.percent) && segment.percent > 0)
        .map((segment, index) => ({
          ...segment,
          color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
          value: Number.isFinite(segment.value)
            ? segment.value
            : Number.isFinite(totalValue)
              ? (totalValue * segment.percent) / 100
              : segment.percent,
        })),
    [segments, totalValue],
  );
  const config = useMemo(
    () =>
      Object.fromEntries(
        data.map((segment, index) => [
          `segment${index}`,
          { label: segment.symbol, color: segment.color },
        ]),
      ),
    [data],
  );

  if (data.length === 0) return null;

  return (
    <div
      data-slot="allocation-donut"
      className={`grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 ${className ?? ""}`}
    >
      <ChartContainer
        config={config}
        className="relative mx-auto h-28 w-28 shrink-0 aspect-square"
        aria-label="Portfolio allocation"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(_value, _name, _item, _index, payload) =>
                  `${formatMoney(payload.value, currency)} · ${formatPercent(payload.percent, {
                    decimals: 1,
                  })}`
                }
              />
            }
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="symbol"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={data.length > 1 ? 2 : 0}
            cornerRadius={3}
            stroke="hsl(var(--tw-card))"
            strokeWidth={2}
            rootTabIndex={-1}
            isAnimationActive={!prefersReducedMotion}
            animationDuration={450}
            shape={(props) => {
              const { payload, ...sectorProps } = props;
              return (
                <Sector
                  {...sectorProps}
                  tabIndex={0}
                  role="img"
                  aria-label={`${payload.symbol}: ${formatPercent(payload.percent, {
                    decimals: 1,
                  })}, ${formatMoney(payload.value, currency)}`}
                  className="outline-none focus-visible:stroke-foreground focus-visible:stroke-[3px]"
                />
              );
            }}
          >
            {data.map((segment) => (
              <Cell key={segment.symbol} fill={segment.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      <ul className="grid min-w-0 gap-1.5 text-xs">
        {data.map((segment) => (
          <li key={segment.symbol} className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {segment.symbol}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatPercent(segment.percent, { decimals: 1 })}
            </span>
            <span className="sr-only">{formatMoney(segment.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
