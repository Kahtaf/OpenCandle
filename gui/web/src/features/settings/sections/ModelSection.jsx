import { Button } from "../../../components/ui/button.jsx";
import { Card } from "../../../components/ui/card.jsx";
import { ConnectModelPanel } from "../../onboarding/ConnectModelPanel.jsx";

/**
 * Settings -> Model.
 *
 * The same `ConnectModelPanel` the onboarding dialog shows, in a page card
 * instead of a modal. Nothing about key entry, probe-before-save, the inline
 * error band, or hosted key retention changes here: this section only supplies
 * the frame and the reasoning default that has no home in the panel.
 */
export function ModelSection({ modelSetup, role = "writer", send }) {
  const hosted = modelSetup?.hosted === true;
  // Matches ConnectModelPanel: only a local follower window is read-only while
  // it waits to reclaim the writer lock. Hosted followers keep full access.
  const setupDisabled = role === "follower" && !hosted;
  const thinkingLevels = modelSetup?.availableThinkingLevels || [];
  const currentThinkingLevel = modelSetup?.currentThinkingLevel || "off";

  return (
    <div className="grid min-w-0 gap-3" data-slot="model-section">
      <Card className="min-w-0 overflow-hidden">
        <ConnectModelPanel variant="manage" modelSetup={modelSetup} role={role} send={send} />
      </Card>
      {thinkingLevels.length > 1 ? (
        <Card className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Reasoning effort</div>
            <p className="m-0 mt-1 max-w-[52ch] text-pretty text-xs leading-relaxed text-muted-foreground">
              How much the model works through a question before answering. The composer keeps its
              own quick switch for one-off changes.
            </p>
          </div>
          <fieldset className="m-0 flex shrink-0 flex-wrap gap-1 border-0 p-0">
            <legend className="sr-only">Reasoning effort</legend>
            {thinkingLevels.map((level) => (
              <Button
                key={level}
                type="button"
                size="sm"
                variant={level === currentThinkingLevel ? "secondary" : "ghost"}
                aria-pressed={level === currentThinkingLevel}
                disabled={setupDisabled}
                data-slot="thinking-level-option"
                className="capitalize"
                onClick={() => {
                  if (setupDisabled) return;
                  send?.("model.setup.set_thinking", { level });
                }}
              >
                {level}
              </Button>
            ))}
          </fieldset>
        </Card>
      ) : null}
    </div>
  );
}
