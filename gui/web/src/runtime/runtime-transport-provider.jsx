import { defaultRuntimeTransport, RuntimeTransportContext } from "./runtime-transport-context.js";

export function RuntimeTransportProvider({ transport, children }) {
  return (
    <RuntimeTransportContext value={transport ?? defaultRuntimeTransport}>
      {children}
    </RuntimeTransportContext>
  );
}
