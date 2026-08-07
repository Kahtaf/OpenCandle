import { RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button.jsx";
import { cn } from "../../../lib/utils.js";
import { ProviderStatusDot } from "./provider-status.jsx";
import {
  formatRelativeTime,
  providerStatus,
  statusColor,
  statusLabel,
} from "./provider-status-info.js";

export function PublicHttpProviderBuilder({ provider, send, setToast }) {
  const status = providerStatus(provider);
  const detail = provider.statusDetail;
  const checkReachability = () => {
    setToast?.(`Checking ${provider.displayName} reachability...`);
    send?.("provider.status.check", { providerId: provider.id });
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderStatusDot status={status} />
          <span className={cn("text-xs font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
          {detail?.checkedAt ? (
            <span className="text-[11px] text-muted-foreground">
              Checked {formatRelativeTime(detail.checkedAt)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {provider.fallbackDescription || "No account or API key is required."}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Probe
        </span>
        <code className="overflow-x-auto rounded-md border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
          {provider.probeUrl}
        </code>
        {detail?.message ? (
          <p className="text-xs leading-5 text-muted-foreground">{detail.message}</p>
        ) : null}
      </div>

      {provider.hosted ? (
        // The hosted runtime cannot run this probe: its status.check command
        // only refreshes diagnostics, so a check button here would do
        // nothing. Availability is settled at boot instead.
        <p className="text-xs leading-5 text-muted-foreground">
          In the hosted app this source's availability is negotiated with the relay when the runtime
          starts.
        </p>
      ) : (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
          <Button variant="brand" size="sm" prefixIcon={RefreshCw} onClick={checkReachability}>
            Check reachability
          </Button>
        </div>
      )}
    </div>
  );
}
