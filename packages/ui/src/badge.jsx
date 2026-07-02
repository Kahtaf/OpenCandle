import { badgeVariants } from "./badge-variants.js";
import { cn } from "./utils.js";

export function Badge({ className, variant, size, ...props }) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
