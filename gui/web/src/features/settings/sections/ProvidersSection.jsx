import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils.js";
import { ProviderBuilder } from "../provider-builders/provider-builder.jsx";
import { ProviderStatusDot } from "../provider-builders/provider-status.jsx";
import {
  providerIcon,
  providerStatus,
  statusColor,
} from "../provider-builders/provider-status-info.js";
import { SettingsCard, SettingsNote } from "../settings-rows.jsx";
import { isLocalOnly, statusLine } from "./provider-row-info.js";

/**
 * Settings -> Data providers.
 *
 * One row per provider in the shared registry, carrying the status the catalog
 * tab used to show, with that provider's existing builder opening inline. The
 * builders themselves are unchanged; this section only decides which one is
 * open and which rows have nothing to offer in this runtime.
 */
export function ProvidersSection({ catalog, send, setToast, focusProvider = "" }) {
  const providers = catalog?.providers ?? [];
  const [expandedId, setExpandedId] = useState(focusProvider || "");
  const [lastFocusProvider, setLastFocusProvider] = useState(focusProvider);

  // A deep link that arrives while the section is already open reopens on the
  // provider it names rather than leaving the previous row expanded.
  if (lastFocusProvider !== focusProvider) {
    setLastFocusProvider(focusProvider);
    if (focusProvider) setExpandedId(focusProvider);
  }

  if (providers.length === 0) {
    return (
      <div className="grid min-w-0 gap-3" data-slot="providers-section">
        <SettingsNote>Provider status appears once OpenCandle connects.</SettingsNote>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3" data-slot="providers-section">
      <SettingsCard>
        {providers.map((provider) => (
          <ProviderSettingsRow
            key={provider.id}
            provider={provider}
            expanded={expandedId === provider.id}
            focused={focusProvider === provider.id}
            onToggle={() =>
              setExpandedId((current) => (current === provider.id ? "" : provider.id))
            }
            send={send}
            setToast={setToast}
          />
        ))}
      </SettingsCard>
      <SettingsNote>
        Keys are checked before they are saved. Locally they live in ~/.opencandle/config.json; in
        the hosted app they stay in this browser.
      </SettingsNote>
    </div>
  );
}

function ProviderSettingsRow({ provider, expanded, focused, onToggle, send, setToast }) {
  const rowRef = useRef(null);
  const status = providerStatus(provider);
  const Icon = providerIcon(provider);
  const localOnly = isLocalOnly(provider);

  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);

  return (
    <div
      ref={rowRef}
      data-slot="provider-row"
      data-provider={provider.id}
      className="border-b border-border last:border-b-0"
    >
      {localOnly ? (
        <div className="flex min-w-0 items-start gap-3 px-4 py-3">
          <ProviderRowLabel provider={provider} Icon={Icon}>
            <span className="text-muted-foreground">Available only in the local app</span>
          </ProviderRowLabel>
        </div>
      ) : (
        <button
          type="button"
          data-slot="provider-row-trigger"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-h-10 w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ProviderRowLabel provider={provider} Icon={Icon}>
            <ProviderStatusDot status={status} />
            <span className={cn(statusColor(status))}>{statusLine(provider, status)}</span>
          </ProviderRowLabel>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
      {expanded && !localOnly ? (
        <div className="border-t border-border bg-secondary/40">
          <ProviderBuilder provider={provider} send={send} setToast={setToast} />
        </div>
      ) : null}
    </div>
  );
}

function ProviderRowLabel({ provider, Icon, children }) {
  return (
    <>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-medium text-foreground">{provider.displayName}</p>
        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-pretty text-xs">
          {children}
        </p>
      </div>
    </>
  );
}
