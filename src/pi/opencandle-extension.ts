import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initDefaultDatabase } from "../memory/sqlite.js";
import { getAllDefaults } from "../memory/tool-defaults.js";
import { getAddonToolDescriptions } from "../tool-kit.js";
import openCandleExtensionCore, {
  type OpenCandleExtensionOptions,
} from "./opencandle-extension-core.js";
import { runOpenCandleSetup } from "./setup.js";
import { getOpenCandleToolDefinitions } from "./tool-adapter.js";

export type { OpenCandleExtensionOptions } from "./opencandle-extension-core.js";

/**
 * Native OpenCandle extension composition used by the local TUI and web GUI.
 * Browser-hosted builds import the core extension and provide a capability-
 * filtered tool list instead of loading the complete Node provider surface.
 */
export default function openCandleExtension(
  pi: ExtensionAPI,
  options?: OpenCandleExtensionOptions,
): void {
  openCandleExtensionCore(pi, {
    ...options,
    toolDefinitions:
      options?.toolDefinitions ??
      getOpenCandleToolDefinitions({
        askUserHandler: options?.askUserHandler,
      }),
    setupRunner: options?.setupRunner ?? runOpenCandleSetup,
    stateDatabaseFactory: options?.stateDatabaseFactory ?? initDefaultDatabase,
    addonToolDescriptionsFactory: options?.addonToolDescriptionsFactory ?? getAddonToolDescriptions,
    toolDefaultsFactory:
      options?.toolDefaultsFactory ??
      ((database) => (database ? getAllDefaults(database) : new Map())),
  });
}
