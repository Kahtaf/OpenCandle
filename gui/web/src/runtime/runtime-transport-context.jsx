import { createContext, useContext } from "react";
import { loopbackRuntimeTransport } from "./runtime-transport.js";

const defaultTransport = loopbackRuntimeTransport;
const RuntimeTransportContext = createContext(defaultTransport);

export function RuntimeTransportProvider({ transport, children }) {
  return (
    <RuntimeTransportContext.Provider value={transport ?? defaultTransport}>
      {children}
    </RuntimeTransportContext.Provider>
  );
}

export function useRuntimeTransport() {
  return useContext(RuntimeTransportContext);
}
