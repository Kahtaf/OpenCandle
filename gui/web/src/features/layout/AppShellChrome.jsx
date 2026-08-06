import { Menu, PanelLeftOpen } from "lucide-react";
import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { Button } from "../../components/ui/button.jsx";
import { AppStatusSlot } from "../../runtime/app-status-slot.jsx";

export function DesktopSidebarRestore({ onExpandSidebar }) {
  return (
    <div className="hidden h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:flex">
      <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onExpandSidebar}>
        <PanelLeftOpen />
      </Button>
      <AppStatusSlot />
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
      <AppStatusSlot />
    </header>
  );
}
