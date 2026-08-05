import { cn } from "../../lib/utils.js";

// Workbench grid for saved-state pages: the primary table takes the available
// width and a fixed-width detail rail sits on the right. Both regions stretch
// to the page height at desktop widths so a short list reads as a surface
// rather than a card floating in the canvas. Narrow viewports collapse to one
// column and keep the page's own bottom-sheet inspector.
export function DetailRailLayout({ rail, children, className }) {
  return (
    <div
      data-slot="detail-rail-layout"
      className={cn(
        "grid min-w-0 grid-cols-1 items-start gap-3 xl:min-h-0 xl:flex-1 xl:items-stretch",
        rail && "xl:grid-cols-[minmax(0,1fr)_320px] min-[1400px]:grid-cols-[minmax(0,1fr)_360px]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col xl:min-h-0">{children}</div>
      {rail ? (
        <div data-slot="detail-rail" className="hidden xl:flex xl:min-h-0 xl:flex-col">
          {rail}
        </div>
      ) : null}
    </div>
  );
}
