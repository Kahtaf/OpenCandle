import { AppStatusSlotContext, useAppStatusSlot } from "./app-status-slot-context.js";

export function AppStatusSlotProvider({ slot = null, children }) {
  return <AppStatusSlotContext value={slot}>{children}</AppStatusSlotContext>;
}

// Renders the host's status element verbatim. The element owns its own markup so
// a host with nothing to say leaves no wrapper behind in the DOM.
export function AppStatusSlot() {
  return useAppStatusSlot();
}
