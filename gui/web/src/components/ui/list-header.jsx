import { Pencil } from "lucide-react";
import { useRef } from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "./button.jsx";
import { nextListTabIndex } from "./list-header-navigation.js";

// One header anatomy for every saved-collection page: the page title with its
// primary action on the same line, then the collection tabs. The rename control
// belongs to the active tab and stays hidden until that tab is hovered or
// something inside it takes focus, so the resting state is just names.
export function ListHeader({ title, actions, tabs, className }) {
  return (
    <header data-slot="list-header" className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
        <h1 className="text-balance text-[17px] font-semibold text-foreground">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {tabs}
    </header>
  );
}

export function ListTabs({
  items,
  activeItem,
  counts,
  readOnly,
  renameLabel,
  onSelect,
  onRename,
  className,
}) {
  // Lazily built so a re-render does not allocate a Map only to throw it away.
  const tabRefs = useRef(null);
  if (tabRefs.current === null) tabRefs.current = new Map();

  const onTabKeyDown = (event, index) => {
    const nextIndex = nextListTabIndex(index, items.length, event.key);
    if (nextIndex === index) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    onSelect(nextItem.id);
    tabRefs.current.get(nextItem.id)?.focus();
  };

  return (
    <div
      data-slot="list-tabs"
      className={cn("flex min-w-0 items-center border-b border-border px-1", className)}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-orientation="horizontal"
      >
        {items.map((item, index) => {
          const active = item.id === activeItem?.id;
          return (
            <div key={item.id} className="group relative flex shrink-0 items-center pr-1">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.id, node);
                  else tabRefs.current.delete(item.id);
                }}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                <span>{item.name}</span>
                <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                  {counts?.get(item.id) ?? 0}
                </span>
              </button>
              {active && onRename ? (
                <Button
                  type="button"
                  data-slot="list-tab-rename"
                  variant="ghost"
                  size="icon-xs"
                  icon={Pencil}
                  title={`${renameLabel} ${item.name}`}
                  aria-label={`${renameLabel} ${item.name}`}
                  disabled={readOnly}
                  // Touch surfaces keep the control visible and 40px wide;
                  // pointer surfaces reveal it on hover or focus.
                  className="size-10 min-h-10 min-w-10 transition-opacity duration-150 ease-out motion-reduce:transition-none md:size-8 md:min-h-8 md:min-w-8 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
                  onClick={() => onRename(item)}
                />
              ) : null}
              {active ? (
                <span
                  data-slot="list-tab-indicator"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
