import { ChevronRight, ListTree } from "lucide-react";
import { textContent } from "../../rendering/text.js";
import { Card } from "../ui/card.jsx";

export function WorkflowStepCard({ content, details }) {
  const label = detailText(details, "label") || "Workflow step";
  const step = detailNumber(details, "step");
  const total = detailNumber(details, "total");
  const stepLabel = step ? `step ${step}${total ? ` of ${total}` : ""}` : "workflow step";

  return (
    <div className="max-w-[760px]" data-slot="workflow-step">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <ListTree className="size-3.5" aria-hidden="true" />
        <span>Workflow</span>
      </div>
      <Card className="overflow-hidden shadow-subtle-xs">
        <details className="group">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-left transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground"
            >
              <ListTree className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{label}</span>
              <span className="block text-[11px] text-muted-foreground">{stepLabel}</span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div className="border-t border-border bg-secondary/40 px-4 py-3">
            <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground">
              {textContent(content)}
            </pre>
          </div>
        </details>
      </Card>
    </div>
  );
}

function detailText(details, key) {
  const value = details && typeof details === "object" ? details[key] : undefined;
  return typeof value === "string" ? value : "";
}

function detailNumber(details, key) {
  const value = details && typeof details === "object" ? details[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
