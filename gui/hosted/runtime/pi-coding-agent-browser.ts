// Audited browser-hosted Pi surface. The package root re-exports interactive
// TUI, package-manager, and every provider path, so the hosted composition
// resolves it to only the SDK modules required by an AgentSession.
export { getAgentDir } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/config.js";
export { DefaultResourceLoader } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js";
export { createAgentSession } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js";
export { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
export { SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js";
