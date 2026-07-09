import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  BOTTOM_SHEET_HANDLE_CLASS,
  BOTTOM_SHEET_SURFACE_CLASS,
  SHEET_OVERLAY_CLASS,
} from "../../components/ui/sheet.jsx";
import { SourceGrid } from "../../components/ui/source-grid.jsx";
import { ToolDrawerStep } from "../renderers/ToolDrawerStep.jsx";
import { summarizeRunTitle } from "../renderers/tool-icon.jsx";
import { extractRunSources } from "./run-sources.js";
import { useToolDrawer } from "./tool-drawer-context.jsx";

// Desktop inline drawer. Renders as a flex sibling of the chat panel so the
// chat layout shrinks left when the drawer opens (a side-by-side splitview
// rather than an overlay). Mounted by App.jsx INSIDE the main flex container.
// On mobile this returns null — the bottom sheet variant lives in
// `ToolDrawerOverlay` which is rendered outside the flex flow.
export function ToolDrawerInline() {
  const { run, close } = useToolDrawer();
  const isMobile = useIsMobile();
  if (isMobile || !run) return null;
  return (
    <aside
      className="flex w-[min(520px,42vw)] shrink-0 flex-col border-l border-border bg-background animate-in slide-in-from-right duration-200"
      aria-label="Tool run timeline"
    >
      <DrawerHeader run={run} onClose={close} />
      <DrawerBody run={run} />
    </aside>
  );
}

// Mobile bottom-sheet overlay using vaul. Mounted at root level (outside the
// main flex container) so it can overlay the chat. Returns null on desktop —
// `ToolDrawerInline` covers that case.
export function ToolDrawerOverlay() {
  const { run, close } = useToolDrawer();
  const isMobile = useIsMobile();
  if (!isMobile || !run) return null;
  return (
    <Drawer.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className={SHEET_OVERLAY_CLASS} />
        <MobileToolDrawerContent run={run} onClose={close} />
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MobileToolDrawerContent({
  run,
  onClose,
  Surface = Drawer.Content,
  Title = Drawer.Title,
}) {
  return (
    <Surface aria-describedby={undefined} className={BOTTOM_SHEET_SURFACE_CLASS}>
      <VisuallyHidden.Root>
        <Title>Tool run timeline</Title>
      </VisuallyHidden.Root>
      <div className={BOTTOM_SHEET_HANDLE_CLASS} aria-hidden="true" />
      <DrawerHeader run={run} onClose={onClose} />
      <DrawerBody run={run} />
    </Surface>
  );
}

function DrawerHeader({ run, onClose }) {
  const title = summarizeRunTitle(run.steps.map((s) => s.name));
  // Escape-to-close — installed only while the drawer is open. Lives in the
  // header so it's mounted alongside the visible UI.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {run.status === "pending"
            ? "In progress"
            : run.status === "error"
              ? "Errored"
              : "Completed"}
        </div>
      </div>
      <Badge variant="outline" size="sm" className="font-mono">
        {run.steps.length} {run.steps.length === 1 ? "step" : "steps"}
      </Badge>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close drawer">
        <X />
      </Button>
    </header>
  );
}

function DrawerBody({ run }) {
  const sources = extractRunSources(run);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 py-3 sm:px-2">
      {sources.length > 0 ? (
        <div className="mb-3 px-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Sources
          </div>
          <SourceGrid sources={sources} max={3} />
        </div>
      ) : null}
      <ol className="grid">
        {run.steps.map((step, index) => (
          <ToolDrawerStep
            key={step.id || `${step.name}-${index}`}
            step={step}
            isLast={index === run.steps.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function useIsMobile() {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 819px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 819px)");
    const onChange = (event) => setMatches(event.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return matches;
}
