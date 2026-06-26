import { cn } from "../../lib/utils.js";

export function Skeleton({ className, ...props }) {
  return <div className={cn("animate-pulse rounded-md bg-primary/10", className)} {...props} />;
}
