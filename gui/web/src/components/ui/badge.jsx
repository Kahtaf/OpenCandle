import { cn } from "../../lib/utils.js";
import { badgeVariants } from "./badge-variants.js";

export function Badge({ className, variant, size, ...props }) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
