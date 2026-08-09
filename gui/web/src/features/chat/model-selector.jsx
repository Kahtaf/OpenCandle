import { Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.jsx";
import { cn } from "../../lib/utils.js";

const PROVIDER_LABEL = {
  google: "Google",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function ModelSelector({ modelSetup, send, disabled, onManageKeys }) {
  const [open, setOpen] = useState(false);
  const availableModels = modelSetup?.availableModels || [];
  const currentModel = modelSetup?.currentModel || "";
  const availableThinkingLevels = modelSetup?.availableThinkingLevels || [];
  const currentThinkingLevel = modelSetup?.currentThinkingLevel || "off";
  const triggerLabel = formatModelLabel(currentModel) || "No model connected";

  const onSelect = (model) => {
    send?.("model.setup.select_model", { provider: model.provider, modelId: model.id });
    setOpen(false);
  };

  // Key management is a settings page now, not a second dialog over the chat.
  const openSetup = () => {
    setOpen(false);
    onManageKeys?.();
  };

  return (
    <div className="relative inline-block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="bordered"
            size="xs"
            disabled={disabled}
            suffixIcon={ChevronDown}
            className="gap-1.5"
          >
            <span className="truncate max-w-[160px]">{triggerLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[280px] p-1">
          <div className="max-h-[280px] overflow-y-auto py-1">
            {availableModels.length > 0 ? (
              <>
                <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Models
                </div>
                {availableModels.map((model) => {
                  const value = `${model.provider}/${model.id}`;
                  const selected = value === currentModel;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => onSelect(model)}
                      className={cn(
                        "flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "bg-secondary",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{formatModelLabel(value)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {PROVIDER_LABEL[model.provider] ?? model.provider}
                        </div>
                      </div>
                      {selected ? (
                        <Check
                          className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No models connected. Add an API key to get started.
              </div>
            )}
          </div>
          <div className="border-t border-border p-1">
            {availableThinkingLevels.length > 1 ? (
              <div className="border-b border-border px-1 pb-2 pt-1">
                <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Reasoning
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableThinkingLevels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={level === currentThinkingLevel}
                      onClick={() => send?.("model.setup.set_thinking", { level })}
                      className={cn(
                        "min-h-8 rounded-md px-2 text-xs capitalize text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        level === currentThinkingLevel && "bg-secondary text-foreground",
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={openSetup}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
                strokeWidth={2}
              />
              <span>Manage model keys…</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function formatModelLabel(value) {
  if (!value) return "";
  const [, ...rest] = value.split("/");
  const modelId = rest.join("/");
  if (!modelId) return value;
  return modelId;
}
