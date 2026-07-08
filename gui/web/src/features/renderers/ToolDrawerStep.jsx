import { AlertCircle, CheckCircle2 } from "lucide-react";
import { StatusDot } from "../../components/ui/status-dot.jsx";
import { TextShimmer } from "../../components/ui/text-shimmer.jsx";
import { cn } from "../../lib/utils.js";
import { textContent } from "../../rendering/text.js";
import { RawDetails } from "./cards/_shared.jsx";
import { extractDetails } from "./cards/card-format.js";
import { GenericCard, rendererFor } from "./cards/index.jsx";
import { ToolIcon, toolMeta } from "./tool-icon.jsx";

// One row in the drawer timeline. Left rail is a small dot + a dashed vertical
// connector down to the next step. Right column shows the tool identity, the
// inputs as compact arg chips, and (when complete) the existing per-tool card
// — but rendered "headless" since the step row already supplies the identity.
export function ToolDrawerStep({ step, isLast }) {
  const meta = toolMeta(step.name);
  const isPending = step.status === "pending";
  const isError = step.status === "error";
  const isComplete = step.status === "completed";

  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)]">
      {/* Left rail */}
      <div className="relative flex flex-col items-center">
        <div className="flex h-6 items-center justify-center">
          <StatusDot status={step.status} />
        </div>
        {!isLast ? (
          <div className="my-0.5 flex-1 border-l border-dashed border-border" aria-hidden="true" />
        ) : (
          <div className="flex-1" aria-hidden="true" />
        )}
      </div>

      {/* Right content */}
      <div className="min-w-0 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <ToolIcon name={step.name} size="sm" status={isError ? "error" : undefined} />
          <span className="text-[13px] font-medium text-foreground">{meta.label}</span>
          {isPending ? (
            <TextShimmer className="text-[11px]">Calling…</TextShimmer>
          ) : isError ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Errored
            </span>
          ) : isComplete ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Completed
            </span>
          ) : null}
        </div>

        <ArgsRow args={step.args} />

        {isComplete || isError ? (
          <div className="mt-2 pr-1">
            <StepResultBody step={step} />
          </div>
        ) : null}

        {step.narrationAfter ? (
          <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
            {step.narrationAfter}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ArgsRow({ args }) {
  const entries = Object.entries(args || {}).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.slice(0, 6).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10.5px]"
        >
          <span className="text-muted-foreground">{k}</span>
          <span className="max-w-[140px] truncate font-mono text-foreground">
            {formatArgValue(v)}
          </span>
        </span>
      ))}
    </div>
  );
}

function formatArgValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return value.length === 0
      ? "[]"
      : `[${value.slice(0, 3).map(formatArgValue).join(", ")}${value.length > 3 ? ", …" : ""}]`;
  return JSON.stringify(value);
}

function StepResultBody({ step }) {
  const message = step.result;
  if (!message) return null;
  const text = textContent(message.content);
  const details = extractDetails(message);
  const renderer = rendererFor(message.toolName);
  const Component = renderer?.Component ?? GenericCard;

  // The step row already carries the tool identity, so we pass an empty header
  // node — the renderer simply skips it. Each card was updated to render
  // without the redundant `[Category] Title` strip.
  const empty = null;

  return (
    <div
      className={cn(
        "grid gap-2",
        message.isError && "rounded-md border border-destructive/30 bg-destructive/5 p-2",
      )}
    >
      <Component message={message} header={empty} text={text} variant="step" />
      {hasAnyDetail(message, details, text) ? (
        <RawDetails message={message} details={details} text={text} />
      ) : null}
    </div>
  );
}

function hasAnyDetail(message, details, text) {
  if (text) return true;
  if (details && Object.keys(details).length > 0) return true;
  if (message?.details?.args && Object.keys(message.details.args).length > 0) return true;
  return false;
}
