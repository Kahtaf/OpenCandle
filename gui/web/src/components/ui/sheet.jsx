import { Drawer } from "vaul";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { cn } from "../../lib/utils.js";

export const Sheet = Drawer.Root;
export const SheetTrigger = Drawer.Trigger;
export const SheetClose = Drawer.Close;

const widthClasses = {
  sm: "md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2",
  md: "md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2",
  lg: "md:left-1/2 md:right-auto md:w-[780px] md:-translate-x-1/2",
  xl: "md:left-1/2 md:right-auto md:w-[920px] md:-translate-x-1/2",
};

export function SheetContent({ children, className, width = "md", handleLabel = "Panel" }) {
  return (
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] overscroll-contain" />
      <Drawer.Content
        aria-describedby={undefined}
        className={cn(
          "fixed inset-x-2 bottom-0 z-50 flex h-[min(88dvh,calc(100dvh-64px))] max-h-[min(88dvh,calc(100dvh-64px))] flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-subtle-md outline-none overscroll-contain md:inset-x-auto md:bottom-4 md:h-auto md:max-h-[84vh] md:rounded-xl",
          widthClasses[width] ?? widthClasses.md,
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

export function SheetHandle({ className }) {
  return (
    <div
      className={cn("mx-auto mb-2 mt-3 h-1 w-9 shrink-0 rounded-full bg-hard", className)}
      aria-hidden="true"
    />
  );
}
