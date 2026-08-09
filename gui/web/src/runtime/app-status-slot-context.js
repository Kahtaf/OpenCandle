import { createContext, useContext } from "react";

// Neutral extension point for the app chrome. The shared shell floats whatever
// the host supplies over the content column and renders nothing at all
// otherwise, so the local GUI carries no hosted-only chrome and gui/web never
// imports from gui/hosted.
export const AppStatusSlotContext = createContext(null);

export function useAppStatusSlot() {
  return useContext(AppStatusSlotContext);
}
