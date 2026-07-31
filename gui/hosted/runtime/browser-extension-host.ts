import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionManager,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import openCandleExtensionCore from "../../../src/pi/opencandle-extension-core.js";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import type { RouterLlmClient } from "../../../src/routing/router-types.js";
import type { StateDatabase } from "../../../src/runtime/state-database.js";

type ExtensionHandler = (
  event: unknown,
  context: ExtensionContext,
) => unknown | Promise<unknown>;

type InputResult =
  | { action: "continue" }
  | { action: "transform"; text: string }
  | { action: "handled" };

const noOpUi = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => undefined,
  onTerminalInput: () => () => undefined,
  setStatus: () => undefined,
  setWorkingMessage: () => undefined,
  setWorkingVisible: () => undefined,
  setWorkingIndicator: () => undefined,
  setHiddenThinkingLabel: () => undefined,
  setWidget: () => undefined,
  setFooter: () => undefined,
  setHeader: () => undefined,
  setTitle: () => undefined,
  custom: async () => undefined,
  pasteToEditor: () => undefined,
  setEditorText: () => undefined,
  getEditorText: () => "",
  editor: async () => undefined,
  addAutocompleteProvider: () => undefined,
  setEditorComponent: () => undefined,
  getEditorComponent: () => undefined,
  get theme() {
    return {};
  },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: "UI not available" }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => undefined,
};

/**
 * Hosted-web extension lifecycle adapter.
 *
 * Pi's full AgentSession is a coding-agent composition and eagerly imports
 * shell, TUI, package discovery, and HTML export code. Hosted OpenCandle needs
 * Pi's model/agent loop and canonical SessionManager, but none of those coding
 * capabilities. This adapter invokes the production OpenCandle extension with
 * the subset of the public ExtensionAPI used by hosted chat.
 */
export class BrowserOpenCandleExtensionHost {
  private readonly handlers = new Map<string, ExtensionHandler[]>();
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly commands = new Map<string, unknown>();
  private activeToolNames: string[] = [];
  private agent: Agent | null = null;

  readonly api: ExtensionAPI;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly model: Model<string>,
    routerLlmClient: RouterLlmClient,
    stateDatabase: StateDatabase,
  ) {
    const api = {
      on: (event: string, handler: ExtensionHandler) => {
        const registered = this.handlers.get(event) ?? [];
        registered.push(handler);
        this.handlers.set(event, registered);
      },
      registerTool: (tool: ToolDefinition) => {
        this.tools.set(tool.name, tool);
        this.activeToolNames = [...this.tools.keys()];
      },
      registerCommand: (name: string, command: unknown) => {
        this.commands.set(name, command);
      },
      registerShortcut: () => undefined,
      registerFlag: () => undefined,
      getFlag: () => undefined,
      registerMessageRenderer: () => undefined,
      registerEntryRenderer: () => undefined,
      sendMessage: (message: {
        customType: string;
        content: string | Array<{ type: "text"; text: string }>;
        display: boolean;
        details?: unknown;
      }) => {
        this.sessionManager.appendCustomMessageEntry(
          message.customType,
          message.content,
          message.display,
          message.details,
        );
      },
      sendUserMessage: (
        content: string | Array<{ type: "text"; text: string }>,
        options?: { deliverAs?: "steer" | "followUp" },
      ) => {
        if (!this.agent) throw new Error("Hosted Pi agent is not bound");
        const text =
          typeof content === "string"
            ? content
            : content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        if (this.agent.state.isStreaming || options?.deliverAs === "followUp") {
          this.agent.followUp(text);
          return;
        }
        void this.agent.prompt(text);
      },
      appendEntry: (customType: string, data?: unknown) => {
        this.sessionManager.appendCustomEntry(customType, data);
      },
      setSessionName: (name: string) => {
        this.sessionManager.appendSessionInfo(name);
      },
      getSessionName: () => this.sessionManager.getSessionName(),
      setLabel: (entryId: string, label: string | undefined) => {
        this.sessionManager.setLabel(entryId, label);
      },
      exec: async () => {
        throw new Error("Shell execution is unavailable in hosted OpenCandle");
      },
      getActiveTools: () => [...this.activeToolNames],
      getAllTools: () =>
        [...this.tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      setActiveTools: (names: string[]) => {
        const known = new Set(this.tools.keys());
        this.activeToolNames = names.filter((name) => known.has(name));
      },
      getCommands: () => [],
      setModel: async () => false,
      getThinkingLevel: () => "off",
      setThinkingLevel: () => undefined,
      registerProvider: () => {
        throw new Error("Dynamic providers are unavailable in hosted OpenCandle");
      },
      unregisterProvider: () => undefined,
      events: {
        on: () => () => undefined,
        emit: async () => undefined,
      },
    };
    this.api = api as unknown as ExtensionAPI;

    openCandleExtensionCore(this.api, {
      routerLlmClient,
      stateDatabaseFactory: () => stateDatabase,
      toolDefinitions: getHostedOpenCandleToolDefinitions(),
      titleCompletion: async () => "OpenCandle research",
    });
  }

  bindAgent(agent: Agent): void {
    this.agent = agent;
  }

  getAgentTools(): ToolDefinition[] {
    return this.activeToolNames.flatMap((name) => {
      const tool = this.tools.get(name);
      return tool ? [tool] : [];
    });
  }

  async start(): Promise<void> {
    await this.emit("session_start", {
      type: "session_start",
      reason: "startup",
    });
  }

  async processInput(text: string): Promise<
    | { action: "continue"; text: string }
    | { action: "transform"; text: string }
    | { action: "handled" }
  > {
    let current = text;
    for (const value of await this.emit("input", {
      type: "input",
      text: current,
      source: "interactive",
    })) {
      const result = value as InputResult | undefined;
      if (!result || result.action === "continue") continue;
      if (result.action === "handled") return result;
      current = result.text;
    }
    return current === text
      ? { action: "continue", text: current }
      : { action: "transform", text: current };
  }

  async prepareSystemPrompt(prompt: string): Promise<string> {
    let systemPrompt = prompt;
    for (const value of await this.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "",
      systemPrompt,
    })) {
      const result = value as { systemPrompt?: string } | undefined;
      if (result?.systemPrompt !== undefined) systemPrompt = result.systemPrompt;
    }
    return systemPrompt;
  }

  async handleAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type === "message_end") {
      const message = event.message;
      if (
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult"
      ) {
        this.sessionManager.appendMessage(message);
      }
    }

    if (event.type === "agent_start") {
      await this.emit("agent_start", { type: "agent_start" });
      return;
    }
    if (event.type === "agent_end") {
      await this.emit("agent_end", {
        type: "agent_end",
        messages: event.messages,
      });
      return;
    }
    if (event.type === "turn_start") {
      await this.emit("turn_start", {
        type: "turn_start",
        turnIndex: 0,
        timestamp: Date.now(),
      });
      return;
    }
    if (event.type === "turn_end") {
      await this.emit("turn_end", {
        type: "turn_end",
        turnIndex: 0,
        message: event.message as AgentMessage,
        toolResults: event.toolResults,
      });
      return;
    }
    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      await this.emit(event.type, event);
    }
  }

  private context(): ExtensionContext {
    return {
      cwd: process.cwd(),
      hasUI: false,
      ui: noOpUi,
      sessionManager: this.sessionManager,
      model: this.model,
      isIdle: () => !this.agent?.state.isStreaming,
      hasPendingMessages: () => this.agent?.hasQueuedMessages() ?? false,
      waitForIdle: async () => {
        await this.agent?.waitForIdle();
      },
      abort: () => this.agent?.abort(),
      signal: this.agent?.signal,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: async () => undefined,
      getSystemPrompt: () => this.agent?.state.systemPrompt ?? "",
      getSystemPromptOptions: () => ({ cwd: process.cwd() }),
      getAllTools: () => this.api.getAllTools(),
      getActiveTools: () => this.api.getActiveTools(),
      setActiveTools: (names: string[]) => this.api.setActiveTools(names),
      getCommands: () => [],
      setModel: async () => false,
      getThinkingLevel: () => "off",
      setThinkingLevel: () => undefined,
    } as unknown as ExtensionContext;
  }

  private async emit(event: string, value: unknown): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of this.handlers.get(event) ?? []) {
      results.push(await handler(value, this.context()));
    }
    return results;
  }
}
