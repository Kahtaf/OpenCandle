import { cn } from "../../lib/utils.js";
import { Favicon } from "./favicon.jsx";

// Compact stacked-favicon pill for "5 sources" summary. Overlapping circles
// give the stacked-coin effect; the count text trails after.
export function SourceStack({ sources, className, onClick, label }) {
  if (!sources?.length) return null;
  const top = sources.slice(0, 4);
  const count = sources.length;
  const interactive = typeof onClick === "function";
  const Tag = interactive ? "button" : "div";
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-border bg-card pl-1 pr-2 py-0.5 text-[11px]",
        interactive &&
          "min-h-10 cursor-pointer transition-[background-color,border-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <span className="flex flex-row">
        {top.map((s, i) => (
          <span key={`${s.url || i}`} className="-mr-1 last:mr-0">
            <Favicon url={s.url} size="xs" className="ring-1 ring-card" />
          </span>
        ))}
      </span>
      <span className="text-foreground">
        {count} {label ?? (count === 1 ? "source" : "sources")}
      </span>
    </Tag>
  );
}
