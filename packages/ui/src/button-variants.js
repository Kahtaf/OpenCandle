import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex min-h-10 min-w-10 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity,transform,scale] duration-150 ease-out active:enabled:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_.button-icon]:h-[var(--button-icon-size)] [&_.button-icon]:w-[var(--button-icon-size)] [&_.button-icon]:shrink-0 [&>svg]:h-[var(--button-icon-size)] [&>svg]:w-[var(--button-icon-size)] [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-secondary text-foreground hover:bg-tertiary",
        brand: "bg-brand text-brand-foreground hover:opacity-90",
        bordered: "border border-border bg-card text-foreground hover:bg-secondary",
        secondary: "bg-secondary text-foreground hover:bg-tertiary",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        link: "h-auto p-0 text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-3 text-sm [--button-icon-size:16px] md:h-9",
        sm: "h-10 px-3 text-sm [--button-icon-size:15px] md:h-8",
        xs: "h-8 px-2 text-xs [--button-icon-size:14px] md:h-7",
        icon: "h-11 min-h-10 w-11 min-w-10 shrink-0 px-0 [--button-icon-size:17px] md:h-10 md:w-10",
        "icon-sm":
          "h-11 min-h-10 w-11 min-w-10 shrink-0 px-0 [--button-icon-size:16px] md:h-10 md:w-10",
        "icon-xs": "h-10 min-h-10 w-10 min-w-10 shrink-0 px-0 [--button-icon-size:14px]",
      },
      rounded: {
        default: "rounded-md",
        lg: "rounded-lg",
        xl: "rounded-xl",
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
