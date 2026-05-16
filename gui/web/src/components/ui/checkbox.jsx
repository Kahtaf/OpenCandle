import { cn } from "../../lib/utils.js";

export function Checkbox({ className, ...props }) {
  return (
    <input
      type="checkbox"
      className={cn("h-4 w-4 rounded border-border accent-brand", className)}
      {...props}
    />
  );
}
