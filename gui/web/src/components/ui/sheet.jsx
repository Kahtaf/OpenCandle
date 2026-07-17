import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { createContext, useContext, useEffect, useState } from "react";
import { Drawer } from "vaul";
import { cn } from "../../lib/utils.js";

// Sheet picks the right physical metaphor for the viewport: a centered modal
// on desktop (zoom + fade animation, focused-task feel) and a bottom-anchored
// drawer with a drag handle on mobile (gesture-native dismiss). vaul's drawer
// animation is bottom-edge-only, so reusing it for a centered desktop panel
// produced a slide-from-right that ended in a hard re-position. Splitting the
// implementation by viewport keeps each metaphor honest.

const DESKTOP_QUERY = "(min-width: 820px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event) => setIsDesktop(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

const SheetContext = createContext({ isDesktop: false });

export function Sheet({ open, onOpenChange, children, autoFocus = false }) {
  const isDesktop = useIsDesktop();
  const Root = isDesktop ? DialogPrimitive.Root : Drawer.Root;
  return (
    <SheetContext.Provider value={{ isDesktop }}>
      <Root open={open} onOpenChange={onOpenChange} autoFocus={isDesktop ? undefined : autoFocus}>
        {children}
      </Root>
    </SheetContext.Provider>
  );
}

const desktopWidthClasses = {
  sm: "w-[calc(100vw-32px)] max-w-[420px]",
  md: "w-[calc(100vw-32px)] max-w-[560px]",
  lg: "w-[calc(100vw-32px)] max-w-[780px]",
  xl: "w-[calc(100vw-32px)] max-w-[920px]",
};

const mobileWidthClasses = {
  sm: "md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2",
  md: "md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2",
  lg: "md:left-1/2 md:right-auto md:w-[780px] md:-translate-x-1/2",
  xl: "md:left-1/2 md:right-auto md:w-[920px] md:-translate-x-1/2",
};

export const SHEET_OVERLAY_CLASS =
  "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] overscroll-contain data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in";

export const BOTTOM_SHEET_SURFACE_CLASS =
  "fixed inset-x-2 bottom-0 z-50 flex h-[min(88dvh,calc(100dvh-64px))] max-h-[min(88dvh,calc(100dvh-64px))] flex-col overflow-hidden rounded-t-xl border border-border bg-secondary shadow-subtle-md outline-none overscroll-contain data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in";

export const BOTTOM_SHEET_HANDLE_CLASS = "mx-auto mb-2 mt-3 h-1 w-9 shrink-0 rounded-full bg-hard";

export function SheetContent({
  children,
  className,
  width = "md",
  handleLabel = "Panel",
  side = "center",
}) {
  const { isDesktop } = useContext(SheetContext);
  if (isDesktop) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={SHEET_OVERLAY_CLASS} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-side={side}
          className={cn(
            side === "right"
              ? "fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(400px,calc(100vw-16px))] max-w-[400px] flex-col overflow-hidden rounded-l-xl border border-border bg-card shadow-subtle-md outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in"
              : "fixed left-1/2 top-1/2 z-50 flex max-h-[min(84dvh,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-subtle-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
            side === "right" ? null : (desktopWidthClasses[width] ?? desktopWidthClasses.md),
            className,
          )}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{handleLabel}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  }
  return (
    <Drawer.Portal>
      <Drawer.Overlay className={SHEET_OVERLAY_CLASS} />
      <Drawer.Content
        aria-describedby={undefined}
        data-side={side}
        className={cn(
          BOTTOM_SHEET_SURFACE_CLASS,
          "md:inset-x-auto md:bottom-4 md:h-auto md:max-h-[84vh] md:rounded-xl",
          mobileWidthClasses[width] ?? mobileWidthClasses.md,
          className,
        )}
      >
        <VisuallyHidden.Root>
          <Drawer.Title>{handleLabel}</Drawer.Title>
        </VisuallyHidden.Root>
        <SheetHandle />
        {children}
      </Drawer.Content>
    </Drawer.Portal>
  );
}

function SheetHandle({ className }) {
  return <div className={cn(BOTTOM_SHEET_HANDLE_CLASS, className)} aria-hidden="true" />;
}
