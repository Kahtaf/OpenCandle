import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Dialog = DialogPrimitive.Root;

const DialogOverlay = forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] overscroll-contain data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
        className,
      )}
      {...props}
    />
  );
});

export const DialogContent = forwardRef(function DialogContent(
  { className, children, ariaTitle, closeButtonClassName, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-[46%] z-50 grid w-[calc(100vw-32px)] max-w-3xl -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-subtle-md outline-none overscroll-contain data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
          className,
        )}
        {...props}
      >
        <VisuallyHidden.Root>
          <DialogPrimitive.Title>{ariaTitle}</DialogPrimitive.Title>
        </VisuallyHidden.Root>
        {children}
        <DialogPrimitive.Close
          aria-label="Close dialog"
          className={cn(
            "absolute right-3 top-3 z-10 inline-flex size-11 min-h-10 min-w-10 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card md:size-10",
            closeButtonClassName,
          )}
        >
          <X className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
