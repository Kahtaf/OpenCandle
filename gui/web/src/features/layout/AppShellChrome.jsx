import { Menu, PanelLeftOpen } from "lucide-react";
import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { Button } from "../../components/ui/button.jsx";

export function DesktopSidebarRestore({ onExpandSidebar }) {
  return (
    <div className="hidden h-12 shrink-0 items-center border-b border-border bg-background px-3 md:flex">
      <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onExpandSidebar}>
        <PanelLeftOpen />
      </Button>
    </div>
  );
}

export function MobileHeader({ onOpenSidebar }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:hidden">
      <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={onOpenSidebar}>
        <Menu />
      </Button>
      <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <OpenCandleLogo />
        OpenCandle
      </div>
    </header>
  );
}
