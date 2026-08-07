import { Menu, PanelLeftOpen } from "lucide-react";
import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useAppStatusSlot } from "../../runtime/app-status-slot-context.js";

// The content column, plus the single floating mount for host runtime status.
// The status element hovers top-center over the page rather than sitting in the
// sidebar header, where a 260px column truncated it. It carries no layout
// footprint and no pointer events, so a page's own primary action underneath
// keeps receiving its clicks.
export function AppContentArea({ children }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {children}
      <AppStatusOverlay />
    </div>
  );
}

export function AppStatusOverlay() {
  const slot = useAppStatusSlot();
  if (!slot) return null;
  return (
    <div
      data-slot="app-status-overlay"
      className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-3 md:top-3"
    >
      <div className="pointer-events-auto min-w-0 max-w-full">{slot}</div>
    </div>
  );
}

export function DesktopSidebarRestore({ onExpandSidebar }) {
  return (
    <div className="hidden h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:flex">
      <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onExpandSidebar}>
        <PanelLeftOpen />
      </Button>
    </div>
  );
}

export function MobileHeader({ onOpenSidebar, onOpenHome }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:hidden">
      <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={onOpenSidebar}>
        <Menu />
      </Button>
      <button
        type="button"
        aria-label="Go to new chat"
        onClick={onOpenHome}
        className="flex min-h-10 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold tracking-tight text-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <OpenCandleLogo />
        <span className="truncate">OpenCandle</span>
      </button>
    </header>
  );
}
