import { AppStatusSlotContext } from "./app-status-slot-context.js";

// The host supplies one status element; the app shell floats it over the content
// column. A host with nothing to say supplies nothing, and the shell then leaves
// no wrapper behind in the DOM.
export function AppStatusSlotProvider({ slot = null, children }) {
  return <AppStatusSlotContext value={slot}>{children}</AppStatusSlotContext>;
}
