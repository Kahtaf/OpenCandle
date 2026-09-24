import { installGuiJourneyFetchGuard } from "./fetch-guard.js";

/**
 * Child-process entry point for the deterministic GUI journey.
 *
 * Launched directly as:
 *   node --import tsx tests/support/gui-journey/gui-server-bootstrap.ts
 *
 * The fetch guard is installed before the real GUI server module is imported,
 * so all of the unmodified `gui/server/server.ts` external traffic is routed
 * through the fixture boundary.
 */

const modelBaseUrl = process.env.OC_GUI_JOURNEY_MODEL_BASE_URL;
const auxBaseUrl = process.env.OC_GUI_JOURNEY_AUX_BASE_URL;
if (!modelBaseUrl || !auxBaseUrl) {
  throw new Error(
    "gui-server-bootstrap requires OC_GUI_JOURNEY_MODEL_BASE_URL and OC_GUI_JOURNEY_AUX_BASE_URL",
  );
}

installGuiJourneyFetchGuard({
  modelBaseUrl,
  auxBaseUrl,
  unexpectedLogPath: process.env.OC_GUI_JOURNEY_UNEXPECTED_LOG,
});

await import("../../../gui/server/server.ts");
