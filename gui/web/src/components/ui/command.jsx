import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";
import { Dialog, DialogContent } from "./dialog.jsx";
import { SheetHandle } from "./sheet.jsx";

export const Command = forwardRef(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-foreground",
        className,
      )}
      {...props}
    />
  );
});

export function CommandDialog({ children, className, ...props }) {
  return (
    <Dialog {...props}>
      <DialogContent
        ariaTitle="Catalog"
        className={cn(
          "fixed bottom-0 left-1/2 top-auto grid h-[min(88dvh,calc(100dvh-64px))] max-h-[min(88dvh,calc(100dvh-64px))] w-[calc(100vw-16px)] -translate-x-1/2 translate-y-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-t-xl rounded-b-none border border-border bg-card pb-[env(safe-area-inset-bottom)] min-[640px]:bottom-auto min-[640px]:left-1/2 min-[640px]:right-auto min-[640px]:top-1/2 min-[640px]:h-auto min-[640px]:min-h-[420px] min-[640px]:max-h-[calc(100dvh-64px)] min-[640px]:w-[calc(100vw-32px)] min-[640px]:-translate-y-1/2 min-[640px]:rounded-xl min-[640px]:pb-0",
          className,
        )}
      >
        <SheetHandle className="min-[640px]:hidden" />
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = forwardRef(function CommandInput({ className, ...props }, ref) {
  return (
    <div
      className={cn(
        "flex min-h-14 items-center gap-2 border-b border-border px-4 pr-14 transition-colors focus-within:border-foreground/40",
        className,
      )}
    >
      <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        ref={ref}
        className="h-10 min-h-0 w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
    </div>
  );
});

export const CommandList = forwardRef(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn(
        "min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-2",
        className,
      )}
      {...props}
    />
  );
});

export const CommandEmpty = forwardRef(function CommandEmpty({ className, ...props }, ref) {
  return <CommandPrimitive.Empty ref={ref} className={cn("py-10 text-center text-sm text-muted-foreground", className)} {...props} />;
});

export const CommandGroup = forwardRef(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      className={cn(
        "overflow-hidden py-1 text-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});

export const CommandItem = forwardRef(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2 text-sm outline-none aria-selected:bg-secondary aria-selected:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const CommandSeparator = forwardRef(function CommandSeparator({ className, ...props }, ref) {
  return <CommandPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
});

export function CommandShortcut({ className, ...props }) {
  return <span className={cn("ml-auto text-xs tracking-wide text-muted-foreground", className)} {...props} />;
}
