import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

/**
 * Radio group — shadcn/ui's Radix construction, styled with this workspace's
 * tokens. Radix owns roving focus, arrow-key traversal, typeahead, form
 * association and the `role="radio"` semantics.
 *
 * Upstream renders a `Circle` icon inside the indicator; the ring here is drawn
 * with a thick border instead, which is what the rest of the GUI's controls do
 * and keeps the dot on the token palette.
 */
export const RadioGroup = forwardRef(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  );
});

export const RadioGroupItem = forwardRef(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="radio-group-item"
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-full border border-hard bg-card transition-[border-color,border-width] duration-150 ease-out data-[state=checked]:border-[5px] data-[state=checked]:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
