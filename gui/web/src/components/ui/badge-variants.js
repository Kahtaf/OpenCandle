import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-0.5 text-[0.7rem] font-medium",
  {
    variants: {
      variant: {
        default: "bg-secondary text-muted-foreground",
        secondary: "bg-secondary text-muted-foreground rounded-full",
        brand: "bg-brand text-brand-foreground",
        outline: "border-border bg-background text-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
      size: {
        sm: "h-5 px-2 text-xs",
        md: "h-6 px-2 text-[11px]",
        lg: "h-7 px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);
