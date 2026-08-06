import { createContext, useContext } from "react";

// Neutral extension point for the app chrome. The shared shell renders whatever
// the host supplies next to the OpenCandle logo and nothing at all otherwise, so
// the local GUI carries no hosted-only chrome and gui/web never imports from
// gui/hosted.
export const AppStatusSlotContext = createContext(null);

export function useAppStatusSlot() {
  return useContext(AppStatusSlotContext);
}
