import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogOverlay = forwardRef(function AlertDialogOverlay(
  { className, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
        className,
      )}
      {...props}
    />
  );
});

export const AlertDialogContent = forwardRef(function AlertDialogContent(
  { className, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-5 text-foreground shadow-subtle-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
});

export function AlertDialogHeader({ className, ...props }) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export const AlertDialogTitle = forwardRef(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      data-slot="alert-dialog-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  );
});

export const AlertDialogDescription = forwardRef(function AlertDialogDescription(
  { className, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

export const AlertDialogAction = forwardRef(function AlertDialogAction(
  { className, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      data-slot="alert-dialog-action"
      className={cn(
        "inline-flex min-h-10 items-center justify-center rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground transition-[background-color,color,opacity,transform,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const AlertDialogCancel = forwardRef(function AlertDialogCancel(
  { className, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      data-slot="alert-dialog-cancel"
      className={cn(
        "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-[background-color,border-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
