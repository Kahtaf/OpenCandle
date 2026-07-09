import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Select = forwardRef(function Select(
  { className, children, size = "default", ...props },
  ref,
) {
  return (
    <span className="relative block">
      <select
        ref={ref}
        className={cn(
          "flex w-full appearance-none rounded-md border border-border bg-card text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-10 px-3 pr-9 text-sm md:h-9" : "h-11 px-4 pr-10 text-sm md:h-9",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
});
