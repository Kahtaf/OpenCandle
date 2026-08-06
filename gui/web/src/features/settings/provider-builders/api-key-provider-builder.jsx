import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.jsx";
import { Input } from "../../../components/ui/input.jsx";
import { cn } from "../../../lib/utils.js";
import { ProviderStatusDot } from "./provider-status.jsx";
import { providerStatus, statusColor, statusLabel } from "./provider-status-info.js";

export function ApiKeyProviderBuilder({ provider, send, setToast }) {
  const providerStateKey = `${provider.id}:${provider.status || ""}`;
  const [lastProviderStateKey, setLastProviderStateKey] = useState(providerStateKey);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const status = providerStatus(provider);
  const envBlocked = status === "env";
  const trimmed = apiKey.trim();
  const canSave = !envBlocked && trimmed.length > 0;

  if (lastProviderStateKey !== providerStateKey) {
    setLastProviderStateKey(providerStateKey);
    setApiKey("");
    setShowApiKey(false);
  }

  const save = () => {
    if (envBlocked) {
      setToast?.(
        `${provider.displayName} is set via ${provider.envVar}. Unset it to override here.`,
      );
      return;
    }
    if (!trimmed) return;
    setToast?.(`Verifying ${provider.displayName} key…`);
    if (send?.("provider.save_api_key", { providerId: provider.id, apiKey: trimmed })) {
      setApiKey("");
    }
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <ProviderStatusDot status={status} />
          <span className={cn("text-xs font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
          {envBlocked ? (
            <code className="text-[11px] text-muted-foreground">env: {provider.envVar}</code>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {provider.fallbackDescription ? (
            <>If absent: {provider.fallbackDescription}.</>
          ) : (
            <>Required for: {(provider.unlocks || []).join(", ") || "this provider's tools"}.</>
          )}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Unlocks
        </span>
        <ul className="grid gap-1">
          {(provider.unlocks || []).map((entry) => (
            <li key={entry} className="flex items-baseline gap-2 text-sm text-foreground">
              <span aria-hidden="true" className="mt-1 h-1 w-1 rounded-full bg-foreground/40" />
              <span>{entry}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-2">
        <label
          htmlFor={`provider-api-key-${provider.id}`}
          className="text-xs font-medium text-foreground"
        >
          API key
        </label>
        <div className="relative">
          <Input
            id={`provider-api-key-${provider.id}`}
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={`Paste your ${provider.displayName} key`}
            disabled={envBlocked}
            className="pr-10 font-mono"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSave) {
                event.preventDefault();
                save();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
            tooltip={showApiKey ? "Hide API key" : "Show API key"}
            onClick={() => setShowApiKey((showing) => !showing)}
            disabled={!apiKey}
          >
            {showApiKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {envBlocked
            ? `Currently set via ${provider.envVar}. Unset that variable to manage the key here.`
            : status === "file"
              ? `${provider.hosted ? "Saved only in this browser" : "Saved to ~/.opencandle/config.json"}${provider.maskedKeyHint ? ` (${provider.maskedKeyHint})` : ""}. Paste a new key to replace.`
              : provider.instructionsHint || "Saved to ~/.opencandle/config.json."}
        </p>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        {provider.signupUrl ? (
          <Button
            variant="ghost"
            size="sm"
            suffixIcon={ExternalLink}
            onClick={() => window.open(provider.signupUrl, "_blank", "noreferrer")}
          >
            Get a key
          </Button>
        ) : null}
        <Button variant="brand" size="sm" onClick={save} disabled={!canSave}>
          {status === "file" ? "Replace key" : "Save key"}
        </Button>
      </div>
    </div>
  );
}
