import { cn } from "../../../lib/utils.js";
import { dangerStatuses, infoStatuses, successStatuses } from "./provider-status-info.js";

export function ProviderStatusDot({ status }) {
  const cls = successStatuses.has(status)
    ? "bg-success"
    : infoStatuses.has(status)
      ? "bg-info"
      : dangerStatuses.has(status)
        ? "bg-destructive"
        : "bg-warning";
  return <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 rounded-full", cls)} />;
}
