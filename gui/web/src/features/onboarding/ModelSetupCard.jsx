import { useState } from "react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Dialog, DialogContent } from "../../components/ui/dialog.jsx";
import { Input } from "../../components/ui/input.jsx";

export function ModelSetupCard({ modelSetup, send, setToast }) {
  return (
    <Card className="mx-auto grid w-full max-w-[760px] gap-4 p-6 shadow-subtle-xs">
      <ModelSetupHeader variant="first-run" />
      <ModelSetupBody modelSetup={modelSetup} send={send} setToast={setToast} />
    </Card>
  );
}

export function ModelSetupDialog({ open, onOpenChange, modelSetup, send, setToast }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ariaTitle="Connect a model" className="max-w-[760px]">
        <div className="grid gap-4 p-6">
          <ModelSetupHeader variant="manage" hasReady={modelSetup?.requirement === "ready"} />
          <ModelSetupBody modelSetup={modelSetup} send={send} setToast={setToast} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelSetupHeader({ variant, hasReady }) {
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
          OpenCandle needs one model key before chat can run. The key is saved in Pi&apos;s local
          auth store and used only for the selected provider.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">Connect a model</h2>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        {hasReady
          ? "Add or switch the model that powers chat. Keys are saved locally in Pi's auth store."
          : "Paste a Google Gemini, OpenAI, or Anthropic API key. Keys are saved locally in Pi's auth store."}
      </p>
    </div>
  );
}

function ModelSetupBody({ modelSetup, send, setToast }) {
  const [keys, setKeys] = useState({});
  const providers = modelSetup?.providers || [];
  const availableModels = modelSetup?.availableModels || [];

  const saveKey = (provider) => {
    const apiKey = keys[provider]?.trim() || "";
    if (!apiKey) {
      setToast?.("Paste an API key first.");
      return;
    }
    setToast?.("Saving model key...");
    send?.("model.setup.save_api_key", { provider, apiKey });
    setKeys((current) => ({ ...current, [provider]: "" }));
  };

  return (
    <>
      {availableModels.length > 0 ? (
        <label className="grid max-w-[420px] gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Available model</span>
          <select
            className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-9"
            value={modelSetup?.currentModel || ""}
            onChange={(event) => selectModel(send, event.target.value)}
          >
            <option value="">Choose model</option>
            {availableModels.map((model) => (
              <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
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
                Uses <code>{provider.envVar}</code> or a saved local key. Default model:{" "}
                <code>{provider.defaultModel}</code>.
              </p>
            </div>
            <label className="grid gap-1.5" htmlFor={`${provider.id}-api-key`}>
              <span className="text-xs font-medium text-muted-foreground">API key</span>
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
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="brand" size="sm" onClick={() => saveKey(provider.id)}>
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
          Pi sign-in is terminal-only for now. Run <code>/login</code> or export an API key, then
          refresh this panel.
        </span>
        <Button variant="bordered" size="sm" onClick={() => send?.("model.setup.refresh")}>
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
