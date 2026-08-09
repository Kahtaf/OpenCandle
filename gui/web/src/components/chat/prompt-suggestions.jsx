import { BookOpen } from "lucide-react";
import { Button } from "../ui/button.jsx";
import { Kbd } from "../ui/kbd.jsx";
import { DEFAULT_PROMPTS } from "./home-prompts.js";

export function EmptyThread({
  prompts = DEFAULT_PROMPTS,
  onPrompt,
  onOpenCatalog,
  disabled = false,
}) {
  return (
    <div className="mx-auto grid w-full max-w-[760px] justify-items-center gap-6 px-2 py-6 text-center sm:py-8">
      <div className="grid gap-2">
        <h1 className="m-0 text-3xl font-semibold leading-tight tracking-tight text-foreground">
          What are we watching?
        </h1>
        <p className="m-0 max-w-[520px] text-sm leading-relaxed text-muted-foreground">
          Ask for quotes, filings, macro data, options chains, or a full research workflow.
        </p>
      </div>
      <PromptSuggestions prompts={prompts} onPrompt={onPrompt} disabled={disabled} />
      {onOpenCatalog ? (
        <button
          type="button"
          onClick={() => onOpenCatalog()}
          className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
          Browse workflows and tools
          <Kbd className="hidden sm:inline-flex">⌘K / Ctrl+K</Kbd>
        </button>
      ) : null}
    </div>
  );
}

export function PromptSuggestions({ prompts = DEFAULT_PROMPTS, onPrompt, disabled = false }) {
  return (
    <div className="flex w-full min-w-0 flex-wrap justify-center gap-2">
      {prompts.map(([label, prompt]) => (
        <Button
          key={label}
          variant="bordered"
          size="sm"
          rounded="full"
          className="h-auto min-h-10 max-w-full whitespace-normal break-words px-3 py-1.5 text-center font-normal text-muted-foreground"
          disabled={disabled}
          onClick={() => {
            if (!disabled) onPrompt(prompt);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
