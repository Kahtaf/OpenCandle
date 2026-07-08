// Plain-JS WebSocket mock injected into the page via Playwright addInitScript.
// Reads `window.__MOCK_PAYLOAD` (set by the harness before this script runs)
// and emits boot/state.snapshot/sessions on construction.
(() => {
  class MockWebSocket extends EventTarget {
    constructor() {
      super();
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      const payload = window.__MOCK_PAYLOAD || {};
      queueMicrotask(() => {
        try {
          this.onopen?.(new Event("open"));
          this._emit({
            type: "boot",
            role: "writer",
            sessionId: "mock-session",
            catalog: payload.catalog,
            modelSetup: payload.modelSetup,
          });
          this._emit({
            type: "state.snapshot",
            sessionId: "mock-session",
            state: payload.dashboard,
            entries: payload.entries || [],
            events: [],
          });
          this._emit({ type: "sessions", sessions: payload.sessions || [] });
        } catch (err) {
          console.error("MockWebSocket boot failure:", err);
        }
      });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.(new CloseEvent("close"));
    }
    _emit(messagePayload) {
      const event = new MessageEvent("message", { data: JSON.stringify(messagePayload) });
      this.dispatchEvent(event);
      this.onmessage?.(event);
    }
  }
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;
  window.WebSocket = MockWebSocket;
  window.__mockReady = true;
})();
