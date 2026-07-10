import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const ScrollArea = forwardRef(function ScrollArea({ className, children, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="h-full w-full rounded-[inherit]"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

export const ScrollBar = forwardRef(function ScrollBar(
  { className, orientation = "vertical", ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5 transition-colors",
        orientation === "vertical" && "h-full w-2 border-l border-l-transparent",
        orientation === "horizontal" && "h-2 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-hard"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
