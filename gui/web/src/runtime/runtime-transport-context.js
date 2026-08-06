import { createContext, useContext } from "react";
import { loopbackRuntimeTransport } from "./runtime-transport.js";

export const defaultRuntimeTransport = loopbackRuntimeTransport;
export const RuntimeTransportContext = createContext(defaultRuntimeTransport);

export function useRuntimeTransport() {
  return useContext(RuntimeTransportContext);
}
