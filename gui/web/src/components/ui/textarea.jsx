import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn("flex min-h-[80px] w-full resize-none rounded-md border-0 bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
});
