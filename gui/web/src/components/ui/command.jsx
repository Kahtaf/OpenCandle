import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Command = forwardRef(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-card text-foreground",
        className,
      )}
      {...props}
    />
  );
});

export const CommandInput = forwardRef(function CommandInput({ className, ...props }, ref) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-10 items-center gap-2 border-b border-border px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring"
      cmdk-input-wrapper=""
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        ref={ref}
        data-slot="command-input"
        className={cn(
          "flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = forwardRef(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      data-slot="command-list"
      className={cn("max-h-72 overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  );
});

export const CommandEmpty = forwardRef(function CommandEmpty({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Empty
      ref={ref}
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

export const CommandGroup = forwardRef(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
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
      data-slot="command-item"
      className={cn(
        "relative flex min-h-10 cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-[13px] outline-none transition-[background-color,transform,scale] duration-150 ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-secondary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const CommandShortcut = forwardRef(function CommandShortcut({ className, ...props }, ref) {
  return (
    <span
      ref={ref}
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
});
