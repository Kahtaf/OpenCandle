import { Clipboard, RefreshCw, Terminal } from "lucide-react";
import { Button } from "../../../components/ui/button.jsx";
import { cn } from "../../../lib/utils.js";
import { ProviderStatusDot } from "./provider-status.jsx";
import {
  formatRelativeTime,
  providerStatus,
  statusColor,
  statusLabel,
} from "./provider-status-info.js";

export function ExternalToolProviderBuilder({ provider, send, setToast }) {
  const status = providerStatus(provider);
  const detail = provider.statusDetail;
  const reenable = status === "skipped";

  const checkInstall = () => {
    setToast?.(
      reenable
        ? `Re-enabling ${provider.displayName} and checking install status...`
        : `Checking ${provider.displayName} install status...`,
    );
    send?.("provider.status.check", { providerId: provider.id, mode: "install", reenable });
  };
  const checkSession = () => {
    setToast?.(
      reenable
        ? `Re-enabling ${provider.displayName} and checking session. This may read browser cookies and trigger a Keychain prompt.`
        : `Checking ${provider.displayName} session. This may read browser cookies and trigger a Keychain prompt.`,
    );
    send?.("provider.status.check", { providerId: provider.id, mode: "session", reenable });
  };
  const copyInstall = () => {
    void navigator.clipboard?.writeText?.(provider.installCmd);
    setToast?.("Install command copied.");
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
        <p className="text-sm leading-5 text-muted-foreground">{provider.fallbackDescription}</p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Install
        </span>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] text-foreground">
            {provider.installCmd}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copy install command"
            tooltip="Copy install command"
            onClick={copyInstall}
          >
            <Clipboard />
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Session source
        </span>
        <p className="text-sm leading-5 text-muted-foreground">
          Uses your normal browser session. Supported browsers:{" "}
          {(provider.supportedBrowsers || []).join(", ") || "Chrome, Arc, Edge, Firefox, Brave"}.
        </p>
        {detail?.message ? (
          <p className="rounded-md border border-border bg-secondary px-3 py-2 text-xs leading-5 text-muted-foreground">
            {detail.message}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="bordered" size="sm" prefixIcon={RefreshCw} onClick={checkInstall}>
          {reenable ? "Re-enable & check install" : "Check install"}
        </Button>
        <Button variant="brand" size="sm" onClick={checkSession}>
          {reenable ? "Re-enable & check session" : "Check session"}
        </Button>
      </div>
    </div>
  );
}
