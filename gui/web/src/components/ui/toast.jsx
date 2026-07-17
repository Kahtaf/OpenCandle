import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const ToastProvider = ToastPrimitives.Provider;

export const ToastViewport = forwardRef(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitives.Viewport
      ref={ref}
      className={cn(
        "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-4 sm:right-4 sm:w-[380px] sm:flex-col",
        className,
      )}
      {...props}
    />
  );
});

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-md border p-4 pr-10 shadow-subtle-md transition-[opacity,transform,translate] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-right-full data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:transition-none",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        destructive: "destructive border-destructive/50 bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const Toast = forwardRef(function Toast({ className, variant, ...props }, ref) {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});

export const ToastAction = forwardRef(function ToastAction({ className, ...props }, ref) {
  return (
    <ToastPrimitives.Action
      ref={ref}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground transition-[background-color,border-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const ToastClose = forwardRef(function ToastClose({ className, ...props }, ref) {
  return (
    <ToastPrimitives.Close
      ref={ref}
      aria-label="Close notification"
      className={cn(
        "absolute right-2 top-2 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground opacity-80 transition-[color,opacity,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-[.destructive]:text-destructive-foreground/80 group-[.destructive]:hover:text-destructive-foreground",
        className,
      )}
      toast-close=""
      {...props}
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Close</span>
    </ToastPrimitives.Close>
  );
});

export const ToastTitle = forwardRef(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitives.Title
      ref={ref}
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  );
});

export const ToastDescription = forwardRef(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitives.Description
      ref={ref}
      className={cn("text-sm opacity-90", className)}
      {...props}
    />
  );
});
