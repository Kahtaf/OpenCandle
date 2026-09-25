import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Test-only transport fixture for the deterministic agent/TUI journey.
 *
 * It exposes a real local HTTP endpoint that speaks the OpenAI-compatible
 * chat-completions streaming protocol. The Pi model runtime treats it as an
 * ordinary external model provider, so the journey exercises the production
 * HTTP transport, streaming parser, tool-call assembly, and provider
 * registration path instead of a stubbed completion function.
 *
 * This is intentionally NOT a production provider: it lives under `tests/`
 * and is only reachable through `127.0.0.1` on an ephemeral port.
 */

export interface ModelChatMessage {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
}

export interface ModelChatRequest {
  model: string;
  messages: ModelChatMessage[];
  tools?: unknown[];
}

export type ModelScriptedReply =
  | { kind: "error"; message: string }
  | {
      kind: "text";
      text: string;
      /**
       * Optional mid-stream hold. The server flushes the first half of the text,
       * awaits this, then flushes the remainder. A caller that aborts the HTTP
       * request while paused produces a socket-close acknowledgement.
       */
      pause?: Promise<void>;
    }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

export type ModelScript = (
  request: ModelChatRequest,
) => ModelScriptedReply | Promise<ModelScriptedReply>;

/**
 * Per-request lifecycle handle. `settled` resolves on the first of a completed
 * response body or a closed socket, so a caller waiting for a held request to
 * finish does not hang when cancellation physically aborts the HTTP request
 * (the server's write may never complete). `aborted` is the stronger signal
 * that the socket closed before the scripted response finished, i.e. an
 * upstream cancellation actually tore the request down.
 */
export interface ModelRequestSettlement {
  request: ModelChatRequest;
  /** Resolves when the scripted response body finished writing. */
  completed: Promise<void>;
  /** Resolves when the request socket closed (client abort or normal end). */
  closed: Promise<void>;
  /** Resolves when the socket closed before the response finished (upstream abort). */
  aborted: Promise<void>;
  /** Resolves on the first of `completed` or `closed`. */
  settled: Promise<void>;
}

export interface DeterministicModelServer {
  /** Base URL to register as the provider `baseUrl` (includes `/v1`). */
  readonly baseUrl: string;
  /** Every parsed chat-completion request the runtime sent, in order. */
  readonly requests: ModelChatRequest[];
  /** Per-request lifecycle handles in request order. */
  readonly settlements: ModelRequestSettlement[];
  stop(): Promise<void>;
}

export async function startDeterministicModelServer(
  script: ModelScript,
): Promise<DeterministicModelServer> {
  const requests: ModelChatRequest[] = [];
  const settlements: ModelRequestSettlement[] = [];
  const server = createServer((req, res) => {
    void handleRequest(req.url, req, res, script, requests, settlements);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    settlements,
    async stop() {
      await closeServer(server);
    },
  };
}

async function handleRequest(
  url: string | undefined,
  req: import("node:http").IncomingMessage,
  res: ServerResponse,
  script: ModelScript,
  requests: ModelChatRequest[],
  settlements: ModelRequestSettlement[],
): Promise<void> {
  if (req.method !== "POST" || !url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Unsupported path: ${req.method} ${url}` } }));
    return;
  }

  const body = await readRequestBody(req);
  let parsed: ModelChatRequest;
  try {
    parsed = JSON.parse(body) as ModelChatRequest;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid JSON body" } }));
    return;
  }

  requests.push(parsed);
  const { settlement, complete, abort, state } = createSettlement(parsed, res);
  settlements.push(settlement);

  try {
    const reply = await script(parsed);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    await writeScriptedReply(res, reply);
    res.end();
    state.finishedNormally = true;
  } catch {
    // The socket may have been aborted while the script or a mid-stream pause
    // was pending; the `closed`/`aborted` acknowledgements already resolved.
  } finally {
    if (state.finishedNormally) complete();
    else abort();
  }
}

function createSettlement(
  request: ModelChatRequest,
  res: ServerResponse,
): {
  settlement: ModelRequestSettlement;
  complete: () => void;
  abort: () => void;
  state: { finishedNormally: boolean };
} {
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = resolve;
  });
  let abort!: () => void;
  const aborted = new Promise<void>((resolve) => {
    abort = resolve;
  });
  const state = { finishedNormally: false };
  res.once("close", () => {
    close();
    if (!state.finishedNormally) abort();
  });
  return {
    settlement: {
      request,
      completed,
      closed,
      aborted,
      settled: Promise.race([completed, closed]),
    },
    complete,
    abort,
    state,
  };
}

async function writeScriptedReply(res: ServerResponse, reply: ModelScriptedReply): Promise<void> {
  const id = "chatcmpl-deterministic-journey";
  const base = { id, object: "chat.completion.chunk", created: 1, model: "oc-journey-model" };

  if (reply.kind === "error") {
    writeSse(res, {
      error: { message: reply.message, type: "server_error", code: "server_error" },
    });
    return;
  }

  if (reply.kind === "text") {
    // Split the text so the journey also exercises multi-delta assembly.
    const midpoint = Math.max(1, Math.floor(reply.text.length / 2));
    const first = reply.text.slice(0, midpoint);
    const second = reply.text.slice(midpoint);
    if (first.length > 0) {
      writeSse(res, {
        ...base,
        choices: [{ index: 0, delta: { content: first }, finish_reason: null }],
      });
    }
    if (reply.pause) await reply.pause;
    if (second.length > 0) {
      writeSse(res, {
        ...base,
        choices: [{ index: 0, delta: { content: second }, finish_reason: null }],
      });
    }
    writeSse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    res.write("data: [DONE]\n\n");
    return;
  }

  const serialized = JSON.stringify(reply.arguments);
  const midpoint = Math.max(1, Math.floor(serialized.length / 2));
  writeSse(res, {
    ...base,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: reply.id,
              type: "function",
              function: { name: reply.name, arguments: "" },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
  // Stream the arguments in two deltas to exercise real fragment assembly.
  writeSse(res, {
    ...base,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: serialized.slice(0, midpoint) } }],
        },
        finish_reason: null,
      },
    ],
  });
  writeSse(res, {
    ...base,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: serialized.slice(midpoint) } }],
        },
        finish_reason: null,
      },
    ],
  });
  writeSse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  res.write("data: [DONE]\n\n");
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
