import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSubTrigger = forwardRef(function DropdownMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex min-h-10 cursor-default select-none items-center rounded-md px-2 py-1.5 text-[13px] text-foreground outline-none transition-[background-color,color,transform,scale] duration-150 ease-out active:scale-[0.96] focus:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-4 w-4" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef(function DropdownMenuSubContent(
  { className, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "z-50 min-w-40 overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-subtle-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-1 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuContent = forwardRef(function DropdownMenuContent(
  { className, sideOffset = 6, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-subtle-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef(function DropdownMenuItem(
  { className, inset, variant = "default", ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex min-h-10 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none transition-[background-color,color,transform,scale] duration-150 ease-out active:scale-[0.96] focus:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuCheckboxItem = forwardRef(function DropdownMenuCheckboxItem(
  { className, children, checked, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex min-h-10 cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-[13px] outline-none transition-[background-color,color,transform,scale] duration-150 ease-out active:scale-[0.96] focus:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef(function DropdownMenuRadioItem(
  { className, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex min-h-10 cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-[13px] outline-none transition-[background-color,color,transform,scale] duration-150 ease-out active:scale-[0.96] focus:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

export const DropdownMenuLabel = forwardRef(function DropdownMenuLabel(
  { className, inset, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground data-[inset]:pl-8",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef(function DropdownMenuSeparator(
  { className, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

export function DropdownMenuShortcut({ className, ...props }) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
}
