import { cn } from "../../lib/utils.js";
import { Favicon } from "./favicon.jsx";
import { hostFrom } from "./favicon-utils.js";

// 4-column source summary grid; on mobile collapses to 2 columns. The fourth
// tile becomes the "+N more" stacked-favicon card when there are more sources
// than columns. Click hands control back to the parent (typically to open the
// drawer / full list view).
export function SourceGrid({ sources, onOpenAll, className, max = 3 }) {
  if (!sources?.length) return null;
  const shown = sources.slice(0, max);
  const overflow = sources.slice(max);
  const hasOverflow = overflow.length > 0;
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      {shown.map((s, i) => (
        <a
          key={`${s.url || s.title || i}`}
          href={s.url || undefined}
          target={s.url ? "_blank" : undefined}
          rel={s.url ? "noreferrer" : undefined}
          className="group flex min-h-[68px] flex-col justify-between rounded-md border border-border bg-card p-2 text-left transition-[background-color,border-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="flex items-center gap-1.5">
            <Favicon url={s.url} size="xs" />
            <span className="line-clamp-1 text-[11px] text-muted-foreground">
              {hostFrom(s.url) || s.source || "source"}
            </span>
          </div>
          <span className="mt-1 line-clamp-2 text-[12px] font-medium text-foreground">
            {s.title || s.snippet || s.url || "—"}
          </span>
        </a>
      ))}
      {hasOverflow ? (
        <button
          type="button"
          onClick={onOpenAll}
          className="flex min-h-[68px] flex-col justify-between rounded-md border border-border bg-secondary p-2 text-left transition-[background-color,border-color,transform,scale] duration-150 ease-out hover:bg-card active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex flex-row pl-0.5">
            {overflow.slice(0, 5).map((s, i) => (
              <span key={`${s.url || i}`} className="-mr-1.5 last:mr-0">
                <Favicon url={s.url} size="xs" className="ring-2 ring-secondary" />
              </span>
            ))}
          </span>
          <span className="mt-1 text-[12px] font-medium text-muted-foreground">
            +{overflow.length} sources
          </span>
        </button>
      ) : null}
    </div>
  );
}
