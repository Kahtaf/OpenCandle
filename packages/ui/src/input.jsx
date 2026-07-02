import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "./utils.js";

const inputVariants = cva(
  "flex w-full rounded-md border border-border bg-card text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "text-sm",
        ghost:
          "border-transparent bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
      },
      size: {
        default: "h-11 px-4 text-sm md:h-9",
        sm: "h-10 px-3 text-sm md:h-9",
      },
      rounded: {
        default: "rounded-md",
        lg: "rounded-lg",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      rounded: "default",
    },
  },
);

export const Input = forwardRef(function Input(
  { className, type = "text", variant, size, rounded, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(inputVariants({ variant, size, rounded }), className)}
      autoComplete="off"
      {...props}
    />
  );
});
