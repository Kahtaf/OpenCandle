import { loadEnv } from "../config.js";
import { initDefaultDatabase } from "../memory/sqlite.js";
import { getAllDefaults } from "../memory/tool-defaults.js";
import { getAddonToolDescriptions } from "../tool-kit.js";
import {
  type CreateOpenCandleSessionOptions,
  type CreateOpenCandleSessionResult,
  createOpenCandleSessionCore,
} from "./session-core.js";
import { runOpenCandleSetup } from "./setup.js";
import { getOpenCandleToolDefinitions } from "./tool-adapter.js";

export type { CreateOpenCandleSessionOptions } from "./session-core.js";

/** Native local TUI and web composition. */
export async function createOpenCandleSession(
  options: CreateOpenCandleSessionOptions = {},
): Promise<CreateOpenCandleSessionResult> {
  // Tool composition reads provider configuration, so hydrate .env before
  // constructing definitions. The core repeats this defensively for callers
  // that supply their own browser-safe composition.
  loadEnv();
  const toolDefinitions =
    options.toolDefinitions ??
    (options.useInlineExtension === false
      ? undefined
      : getOpenCandleToolDefinitions({
          askUserHandler: options.askUserHandler,
        }));
  return createOpenCandleSessionCore({
    ...options,
    stateDatabaseFactory: options.stateDatabaseFactory ?? initDefaultDatabase,
    toolDefinitions,
    setupRunner: options.setupRunner ?? runOpenCandleSetup,
    addonToolDescriptionsFactory: options.addonToolDescriptionsFactory ?? getAddonToolDescriptions,
    toolDefaultsFactory:
      options.toolDefaultsFactory ??
      ((database) => (database ? getAllDefaults(database) : new Map())),
  });
}
