import * as Tooltip from "@radix-ui/react-tooltip";
import { ExternalLink } from "lucide-react";
import { Favicon } from "./favicon.jsx";
import { hostFrom, shortHost } from "./favicon-utils.js";
import { cn } from "../../lib/utils.js";

// Compact pill: favicon + hostname. Clickable when given a url; the surrounding
// HoverCard supplies the rich preview (title/snippet) lazily.
export function SourcePill({ url, label, title, snippet, className, onClick }) {
  const host = shortHost(url) || label || url || "source";
  const showHover = Boolean(title || snippet);

  const pill = (
    <a
      href={url || undefined}
      target={url ? "_blank" : undefined}
      rel={url ? "noreferrer" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <Favicon url={url} size="xs" />
      <span className="max-w-[120px] truncate">{host}</span>
    </a>
  );

  if (!showHover) return pill;

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{pill}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-[60] max-w-[320px] rounded-lg border border-border bg-card p-3 text-left shadow-subtle-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Favicon url={url} size="xs" />
              <span className="truncate">{hostFrom(url)}</span>
              {url ? <ExternalLink className="ml-auto h-3 w-3" aria-hidden="true" /> : null}
            </div>
            {title ? <div className="mt-1.5 line-clamp-2 text-[13px] font-medium text-foreground">{title}</div> : null}
            {snippet ? <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{snippet}</div> : null}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
