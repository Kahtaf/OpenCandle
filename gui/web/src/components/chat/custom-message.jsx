import { textContent } from "../../rendering/text.js";
import { Badge } from "../ui/badge.jsx";
import { Button } from "../ui/button.jsx";
import { WorkflowStepCard } from "./workflow-step-card.jsx";

export function CustomMessage({ customType, content, details, onFixModelKey, onRetry }) {
  if (customType === "opencandle-workflow-step") {
    return <WorkflowStepCard content={content} details={details} />;
  }

  if (customType === "opencandle-model-run-failed") {
    return (
      <div className="max-w-[760px] rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <div className="mb-1 font-medium text-destructive">Model connection failed</div>
        <p className="m-0 text-foreground">{textContent(content)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="bordered" size="sm" onClick={onRetry}>
            Retry
          </Button>
          <Button type="button" variant="brand" size="sm" onClick={onFixModelKey}>
            Fix model key
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[760px] flex-wrap items-start gap-2 text-sm">
      <Badge variant="warning">{customType}</Badge>
      <span className="text-foreground">{textContent(content)}</span>
    </div>
  );
}
