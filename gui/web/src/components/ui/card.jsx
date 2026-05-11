import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }) {
  return <div className={cn("rounded-lg border border-border bg-card text-card-foreground", className)} {...props} />;
}
