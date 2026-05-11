import { cn } from "../../lib/utils.js";

export function HistoryItem({ session, active, onOpen }) {
  const title = session.name || session.firstMessage || "Untitled session";
  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      className={cn(
        "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-secondary",
        active
          ? "bg-tertiary text-foreground"
          : "text-muted-foreground hover:bg-tertiary hover:text-foreground",
      )}
      title={title}
    >
      {title}
    </button>
  );
}
