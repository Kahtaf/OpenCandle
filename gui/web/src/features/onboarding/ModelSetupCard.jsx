import { useId, useState } from "react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Dialog, DialogContent } from "../../components/ui/dialog.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Select } from "../../components/ui/select.jsx";

export function ModelSetupCard({ modelSetup, role = "writer", send, setToast }) {
  return (
    <Card className="mx-auto grid w-full max-w-[760px] gap-4 p-6 shadow-subtle-xs">
      <ModelSetupHeader
        variant="first-run"
        role={role}
        requirement={modelSetup?.requirement}
        hosted={modelSetup?.hosted}
      />
      <ModelSetupBody modelSetup={modelSetup} role={role} send={send} setToast={setToast} />
    </Card>
  );
}

export function ModelSetupDialog({
  open,
  onOpenChange,
  modelSetup,
  role = "writer",
  send,
  setToast,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ariaTitle="Connect a model" className="max-w-[760px]">
        <div className="grid gap-4 p-6">
          <ModelSetupHeader
            variant="manage"
            hasReady={modelSetup?.requirement === "ready"}
            role={role}
            requirement={modelSetup?.requirement}
            hosted={modelSetup?.hosted}
          />
          <ModelSetupBody modelSetup={modelSetup} role={role} send={send} setToast={setToast} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelSetupHeader({ variant, hasReady, role, requirement, hosted }) {
  const setupUnavailable = role === "follower" && !hosted;
  if (variant === "first-run") {
    return (
      <div className="grid gap-2">
        <Badge variant="success" className="w-fit">
          First run
        </Badge>
        <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
          Connect an AI model
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          {setupUnavailable
            ? "Model setup is unavailable in this window while OpenCandle reconnects local setup access."
            : requirement === "select_model"
              ? "OpenCandle found model credentials. Choose one model below and chat will be ready."
              : hosted
                ? "Add an OpenAI, Anthropic, or Google key to run Pi models directly in this browser. OpenCandle never sends it to an OpenCandle server."
                : "OpenCandle needs one model before chat can run. Paste a key below or use terminal sign-in, then start chatting from the same window."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">Connect a model</h2>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        {setupUnavailable
          ? "Model setup is unavailable in this window while OpenCandle reconnects local setup access."
          : hasReady
            ? hosted
              ? "Add or replace model keys kept by this browser. Saved keys are never shown again."
              : "Add or switch the model that powers chat. Keys are saved locally in Pi's auth store."
            : hosted
              ? "Paste an OpenAI, Anthropic, or Google API key and choose how long this browser should keep it."
              : "Paste a Google Gemini, OpenAI, or Anthropic API key. Keys are saved locally in Pi's auth store."}
      </p>
    </div>
  );
}

function ModelSetupBody({ modelSetup, role, send, setToast }) {
  const modelSelectId = useId();
  const [keys, setKeys] = useState({});
  const [storageMode, setStorageMode] = useState(modelSetup?.storageMode || "persistent");
  const providers = modelSetup?.providers || [];
  const availableModels = modelSetup?.availableModels || [];
  const setupError = modelSetup?.error || "";
  const hosted = modelSetup?.hosted === true;
  const setupDisabled = role === "follower" && !hosted;

  const saveKey = (provider) => {
    const apiKey = keys[provider]?.trim() || "";
    if (!apiKey) {
      setToast?.("Paste an API key first.");
      return;
    }
    if (setupDisabled) {
      setToast?.("Model setup is unavailable in this window while OpenCandle reconnects.");
      return;
    }
    setToast?.("Saving model key...");
    send?.("model.setup.save_api_key", { provider, apiKey, ...(hosted ? { storageMode } : {}) });
    setKeys((current) => ({ ...current, [provider]: "" }));
  };

  return (
    <>
      {setupDisabled ? (
        <div className="rounded-md border border-amber-700/30 bg-amber-100/60 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-300/30 dark:bg-amber-950/30 dark:text-amber-200">
          Model setup changes are unavailable in this window while OpenCandle reconnects local setup
          access.
        </div>
      ) : null}
      {setupError ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {setupError}
        </div>
      ) : null}
      {availableModels.length > 0 ? (
        <label htmlFor={modelSelectId} className="grid max-w-[420px] gap-1.5">
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
      {hosted ? (
        <fieldset className="grid gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Keep this key</legend>
          <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              type="radio"
              name="hosted-key-storage"
              value="persistent"
              checked={storageMode === "persistent"}
              onChange={() => setStorageMode("persistent")}
              className="mt-1"
            />
            <span>
              <strong className="block font-medium">Keep on this device</strong>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Available after closing and reopening the installed app.
              </span>
            </span>
          </label>
          <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              type="radio"
              name="hosted-key-storage"
              value="session"
              checked={storageMode === "session"}
              onChange={() => setStorageMode("session")}
              className="mt-1"
            />
            <span>
              <strong className="block font-medium">Only for this browser session</strong>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Removed after the final OpenCandle tab closes.
              </span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <div
            className="grid content-start gap-3 rounded-md border border-border bg-secondary p-3"
            key={provider.id}
          >
            <div>
              <h3 className="m-0 mb-1 text-sm font-semibold text-foreground">{provider.label}</h3>
              <p className="m-0 text-xs leading-5 text-muted-foreground">
                {hosted ? (
                  "Runs directly from this browser."
                ) : (
                  <>
                    <span>Uses </span>
                    <code>{provider.envVar}</code>
                    <span> or a saved local key. </span>
                  </>
                )}
                Default model: <code>{provider.defaultModel}</code>.
              </p>
            </div>
            <label className="grid gap-1.5" htmlFor={`${provider.id}-api-key`}>
              <span className="text-xs font-medium text-muted-foreground">
                {provider.label} API key
              </span>
              <Input
                id={`${provider.id}-api-key`}
                type="password"
                name={`${provider.id}-api-key`}
                value={keys[provider.id] || ""}
                onChange={(event) =>
                  setKeys((current) => ({ ...current, [provider.id]: event.target.value }))
                }
                autoComplete="off"
                placeholder={`${provider.label} API key`}
                spellCheck={false}
                disabled={setupDisabled}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="brand"
                size="sm"
                onClick={() => saveKey(provider.id)}
                disabled={setupDisabled}
              >
                Save key
              </Button>
              <Button asChild variant="bordered" size="sm">
                <a href={provider.signupUrl} target="_blank" rel="noreferrer">
                  Get key
                </a>
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground sm:flex-row sm:items-center">
        <span className="text-xs">
          {hosted ? (
            "Device storage can be read by same-origin scripts, browser extensions with site access, and anyone with access to this browser profile."
          ) : (
            <>
              <span>Prefer browser sign-in? Run </span>
              <code>/setup</code>
              <span> in the terminal, then refresh this panel.</span>
            </>
          )}
        </span>
        <Button
          variant="bordered"
          size="sm"
          onClick={() => send?.("model.setup.refresh")}
          disabled={setupDisabled}
        >
          Refresh
        </Button>
      </div>
    </>
  );
}

function selectModel(send, value) {
  if (!value) return;
  const [provider, ...modelParts] = value.split("/");
  const modelId = modelParts.join("/");
  if (provider && modelId) send?.("model.setup.select_model", { provider, modelId });
}
