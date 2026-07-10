import { createContext, forwardRef, useContext, useId } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils.js";

const ChartContext = createContext(null);

function useChart() {
  const context = useContext(ChartContext);
  if (!context) throw new Error("Chart components must be used inside <ChartContainer>");
  return context;
}

export const ChartContainer = forwardRef(function ChartContainer(
  { id, className, children, config, style, ...props },
  ref,
) {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  const colorVars = Object.fromEntries(
    Object.entries(config).flatMap(([key, item]) =>
      item.color ? [[`--color-${key}`, item.color]] : [],
    ),
  );

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        data-slot="chart"
        data-chart={chartId}
        className={cn("flex aspect-video justify-center text-xs", className)}
        style={{ ...colorVars, ...style }}
        {...props}
      >
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});

export const ChartTooltip = Tooltip;

export const ChartTooltipContent = forwardRef(function ChartTooltipContent(
  {
    active,
    payload,
    className,
    indicator = "dot",
    hideLabel = false,
    hideIndicator = false,
    label,
    labelFormatter,
    formatter,
    nameKey,
    labelKey,
  },
  ref,
) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const tooltipLabel = labelFormatter
    ? labelFormatter(label, payload)
    : (getConfig(payload[0], config, labelKey)?.label ?? label);

  return (
    <div
      ref={ref}
      data-slot="chart-tooltip"
      className={cn(
        "grid min-w-32 gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-subtle-sm",
        className,
      )}
    >
      {!hideLabel && tooltipLabel ? (
        <div className="font-medium text-foreground">{tooltipLabel}</div>
      ) : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const itemConfig = getConfig(item, config, nameKey);
          const color = item.payload?.fill ?? item.color;
          const itemName = itemConfig?.label ?? item.name ?? item.dataKey;
          const itemKey = item.dataKey ?? item.name ?? item.value;
          return (
            <div key={itemKey} className="flex items-center gap-2">
              {!hideIndicator ? (
                <span
                  className={cn("shrink-0 rounded-sm", indicator === "dot" ? "h-2 w-2" : "h-3 w-1")}
                  style={{ backgroundColor: color }}
                />
              ) : null}
              <span className="text-muted-foreground">{itemName}</span>
              <span className="ml-auto font-medium tabular-nums text-foreground">
                {formatter
                  ? formatter(item.value, item.name, item, index, item.payload)
                  : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function getConfig(item, config, key) {
  const configKey = key ?? item.dataKey ?? item.name;
  return config[configKey] ?? config[item.name] ?? config[item.dataKey];
}
