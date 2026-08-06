import { useCallback } from "react";
import { buildToolInvokeHttpFallbackRequest } from "../../hooks/useGuiConnection.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";

// Settings sections are rendered outside the chat shell, so they invoke tools
// straight through the runtime transport instead of the chat connection. The
// request shape stays the one the shared GUI tool route already accepts, and
// settings runs never enter a transcript.
export function useSettingsToolInvoker() {
  const transport = useRuntimeTransport();

  return useCallback(
    async (toolName, args = {}) => {
      const bootstrap = await transport.bootstrap();
      const sessionId = String(bootstrap?.sessionId ?? bootstrap?.snapshot?.sessionId ?? "").trim();
      if (!sessionId) throw new Error("OpenCandle could not open a session for this change.");
      const request = buildToolInvokeHttpFallbackRequest(toolName, args, sessionId, sessionId, {
        recordTranscript: false,
      });
      return transport.invokeTool(request.body);
    },
    [transport],
  );
}
