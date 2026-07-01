import { forwardRef } from "react";
import { cn } from "./utils.js";

export const Kbd = forwardRef(function Kbd({ className, children, ...props }, ref) {
  return (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 items-center justify-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
});
