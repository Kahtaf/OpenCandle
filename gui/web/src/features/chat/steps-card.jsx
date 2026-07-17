import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { SourceStack } from "../../components/ui/source-stack.jsx";
import { StatusDot } from "../../components/ui/status-dot.jsx";
import { TextShimmer } from "../../components/ui/text-shimmer.jsx";
import { cn } from "../../lib/utils.js";
import { summarizeRunTitle, ToolIcon, toolMeta } from "../renderers/tool-icon.jsx";
import { extractRunSources } from "./run-sources.js";
import { useToolDrawer } from "./tool-drawer-context.jsx";

// In-thread collapsed view of a tool_run. Clicking opens the drawer with the
// full timeline. Layout follows llmchat's pattern: small eyebrow ("Working"
// or "Answer"), then a row of icon + title + step badge + caret. While the
// run is still pending the title shimmers and the icon spins.
export function StepsCard({ run, autoOpen = false, onRetry, retryDisabled = false }) {
  const { open, requestAutoOpen, run: openRun } = useToolDrawer();
  const isOpen = openRun?.id === run.id && (openRun?.sessionId || "") === (run.sessionId || "");
  const stepCount = run.steps.length;
  const title = summarizeRunTitle(run.steps.map((s) => s.name));
  const isPending = run.status === "pending";
  const isError = run.status === "error";
  const completedCount = run.steps.filter((s) => s.status === "completed").length;
  const sources = extractRunSources(run);
  const canRetry = isError && Boolean(run.retryPrompt) && Boolean(onRetry);

  useEffect(() => {
    if (!autoOpen) return;
    requestAutoOpen(run);
  }, [autoOpen, run, requestAutoOpen]);

  // What's the active step? While pending, show its label as shimmering text
  // beneath the title (e.g. "Fetching get_stock_quote AAPL").
  const activeStep = run.steps.find((s) => s.status === "pending");
  const activeMeta = activeStep ? toolMeta(activeStep.name) : null;

  return (
    <div className="max-w-[760px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        <span>{isPending ? "Working" : isError ? "Tool error" : "Answer"}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => open(run)}
          className={cn(
            "group flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left shadow-subtle-xs transition-[background-color,border-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isOpen && "bg-secondary",
          )}
          aria-expanded={isOpen}
        >
          <RunLeadingIcon run={run} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
            {isPending ? (
              <TextShimmer className="block truncate text-[11px]">
                {activeMeta
                  ? `Calling ${activeMeta.label.toLowerCase()}${argSummary(activeStep) ? ` · ${argSummary(activeStep)}` : ""}`
                  : `Working · ${completedCount} of ${stepCount} ${stepCount === 1 ? "step" : "steps"} done`}
              </TextShimmer>
            ) : isError && run.failureReason ? (
              <div className="truncate text-[11px] text-destructive">{run.failureReason}</div>
            ) : (
              <div className="truncate text-[11px] text-muted-foreground">
                {completedCount} of {stepCount} {stepCount === 1 ? "step" : "steps"}
                {sources.length > 0
                  ? ` · ${sources.length} ${sources.length === 1 ? "source" : "sources"}`
                  : ""}
              </div>
            )}
          </div>
          {sources.length > 0 && !isPending ? (
            <span className="hidden sm:inline-flex">
              <SourceStack sources={sources} />
            </span>
          ) : null}
          <Badge variant="outline" size="sm" className="shrink-0 font-mono">
            {stepCount} {stepCount === 1 ? "step" : "steps"}
          </Badge>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
        {canRetry ? (
          <Button
            type="button"
            variant="bordered"
            size="sm"
            prefixIcon={RotateCcw}
            disabled={retryDisabled}
            onClick={() => onRetry(run.retryPrompt)}
          >
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RunLeadingIcon({ run }) {
  // Show the first tool's icon — gives the card a recognizable face even when
  // multiple tools are involved. Status is conveyed by the eyebrow label
  // ("Working" / "Answer" / "Tool error") and the shimmer subtitle, so we don't
  // double up with a dot overlay here (it read as a white blob against the
  // yellow icon).
  const first = run.steps[0];
  if (!first) return <StatusDot status="pending" />;
  return (
    <ToolIcon name={first.name} size="lg" status={run.status === "error" ? "error" : undefined} />
  );
}

function argSummary(step) {
  if (!step?.args) return "";
  const entries = Object.entries(step.args).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return "";
  const [, v] = entries[0];
  const value = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (!value) return "";
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}
