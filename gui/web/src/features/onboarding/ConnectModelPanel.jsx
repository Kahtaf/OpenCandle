import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Select } from "../../components/ui/select.jsx";
import { ProviderKeyFlow } from "./ProviderKeyFlow.jsx";

export function ConnectModelPanel({
  variant = "first-run",
  modelSetup,
  role,
  send,
  selectedProviderId,
  onSelectedProviderIdChange,
}) {
  const modelSelectId = useId();
  const [pendingProviderId, setPendingProviderId] = useState("");
  const [dismissedError, setDismissedError] = useState("");
  const providers = modelSetup?.providers || [];
  const availableModels = modelSetup?.availableModels || [];
  const reportedError = modelSetup?.error || "";
  // A setup error names the provider it came from. Switching providers must
  // not leave an OpenAI rejection sitting above the Anthropic key field.
  const setupError = reportedError && reportedError !== dismissedError ? reportedError : "";
  const hosted = modelSetup?.hosted === true;
  // Hosted followers keep full setup access by design; only a local follower
  // window is read-only while it waits to reclaim the writer lock.
  const setupDisabled = role === "follower" && !hosted;

  // The browser gets no per-request acknowledgement for a key save, so the
  // pending state clears when the parts of model setup a save could have
  // changed actually change. A concurrent change from another tab can clear it
  // early; that is cosmetic (the button label reverts) and never loses input.
  const settleSignal = [
    modelSetup?.requirement ?? "",
    reportedError,
    modelSetup?.currentModel ?? "",
    providers.map((provider) => provider.id).join(","),
    availableModels.length,
  ].join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: settleSignal is the derived settle trigger
  useEffect(() => {
    setPendingProviderId("");
  }, [settleSignal]);

  const saveKey = ({ provider, apiKey, storageMode }) => {
    if (setupDisabled) return;
    setPendingProviderId(provider);
    setDismissedError("");
    send?.("model.setup.save_api_key", {
      provider,
      apiKey,
      ...(storageMode ? { storageMode } : {}),
    });
  };

  return (
    // `data-no-swipe`: a drag anywhere on this step must never navigate away.
    // Leaving the step unmounts the key form, which is how a typed secret is
    // discarded: correct on a deliberate Back, data loss on a stray swipe.
    <div
      data-slot="connect-model-panel"
      data-no-swipe
      className="grid gap-5 p-7 sm:gap-6 sm:p-8 [@media(min-height:880px)]:p-9"
    >
      <ConnectModelHeading
        variant={variant}
        role={role}
        requirement={modelSetup?.requirement}
        hosted={hosted}
      />
      {setupDisabled ? (
        <div className="rounded-md border border-amber-700/30 bg-amber-100/60 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-300/30 dark:bg-amber-950/30 dark:text-amber-200">
          Model setup changes are unavailable while this window reconnects.
        </div>
      ) : null}
      {setupError ? (
        <div
          data-slot="model-setup-error"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {setupError}
        </div>
      ) : null}
      {availableModels.length > 0 ? (
        <label htmlFor={modelSelectId} className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Available model</span>
          <Select
            id={modelSelectId}
            value={modelSetup?.currentModel || ""}
            onChange={(event) => selectModel(send, event.target.value)}
            disabled={setupDisabled}
          >
            <option value="">Choose model</option>
            {availableModels.map((model) => (
              <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                {model.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <ProviderKeyFlow
        providers={providers}
        hosted={hosted}
        defaultStorageMode={modelSetup?.storageMode || "persistent"}
        disabled={setupDisabled}
        pendingProviderId={pendingProviderId}
        selectedProviderId={selectedProviderId}
        onSubmit={saveKey}
        onSelectedProviderChange={(nextId) => {
          setDismissedError(reportedError);
          onSelectedProviderIdChange?.(nextId);
        }}
      />
      {/* Footnotes, kept below a hairline and at label weight so they never
          compete with the provider choice above them. */}
      <div className="flex flex-col items-start justify-between gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="text-xs leading-relaxed text-muted-foreground">
          {hosted ? (
            "Device storage is readable by same-origin scripts, browser extensions with site access, and anyone using this browser profile."
          ) : (
            <>
              <span>Prefer a provider account sign-in? Run </span>
              <code>/setup</code>
              <span> in the OpenCandle terminal, then Refresh.</span>
            </>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => send?.("model.setup.refresh")}
          disabled={setupDisabled}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}

function ConnectModelHeading({ variant, role, requirement, hosted }) {
  const setupUnavailable = role === "follower" && !hosted;
  // No status badge here. Semantic colour is reserved for market and system
  // state (DESIGN.md), and "First run" was decorating a screen whose position
  // the step dots already report.
  if (variant === "first-run") {
    return (
      <div className="grid gap-2 pr-10">
        <h2 className="m-0 text-balance text-xl font-semibold tracking-tight text-foreground">
          Connect an AI model
        </h2>
        <p className="m-0 max-w-[48ch] text-pretty text-sm leading-relaxed text-muted-foreground">
          {setupUnavailable
            ? "Setup is unavailable while this window reconnects."
            : requirement === "select_model"
              ? "OpenCandle found your credentials. Choose a model to finish."
              : hosted
                ? "Add an OpenAI, Anthropic, or Google key to run Pi in this browser. Provider requests pass through OpenCandle's audited relay, which processes keys in memory without storing them."
                : "Pick a provider and paste its key. The key stays on this machine."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-2 pr-10">
      <h2 className="m-0 text-balance text-xl font-semibold tracking-tight text-foreground">
        Connect a model
      </h2>
      <p className="m-0 max-w-[48ch] text-pretty text-sm leading-relaxed text-muted-foreground">
        {setupUnavailable
          ? "Setup is unavailable while this window reconnects."
          : requirement === "ready"
            ? hosted
              ? "Add or replace the keys this browser keeps. Saved keys are never shown again."
              : "Add or switch the chat model. Keys are saved in Pi's local auth store."
            : hosted
              ? "Paste an API key and choose how long this browser keeps it."
              : "Paste an API key. Keys are saved in Pi's local auth store."}
      </p>
    </div>
  );
}

function selectModel(send, value) {
  if (!value) return;
  const [provider, ...modelParts] = value.split("/");
  const modelId = modelParts.join("/");
  if (provider && modelId) send?.("model.setup.select_model", { provider, modelId });
}
