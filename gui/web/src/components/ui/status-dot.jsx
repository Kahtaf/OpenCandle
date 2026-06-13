import { cn } from "../../lib/utils.js";

// Status indicator dot: a tiny static dot for completed, a ping aura for
// pending, rose for errored. Sized within a 12px frame so it lines up with
// surrounding text. Used in the step timeline and the in-thread StepsCard.
export function StatusDot({ status = "pending", className }) {
  if (status === "completed") {
    return (
      <span
        className={cn("relative inline-flex size-3 items-center justify-center", className)}
        aria-hidden="true"
      >
        <span className="size-1.5 rounded-full bg-foreground" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className={cn("relative inline-flex size-3 items-center justify-center", className)}
        aria-hidden="true"
      >
        <span className="size-1.5 rounded-full bg-destructive" />
      </span>
    );
  }
  // pending — radar ping around a small foreground dot
  return (
    <span
      className={cn("relative inline-flex size-3 items-center justify-center", className)}
      aria-hidden="true"
    >
      <span className="absolute inline-flex size-3 animate-ping rounded-full bg-foreground/30" />
      <span className="relative inline-flex size-1.5 rounded-full bg-foreground" />
    </span>
  );
}
