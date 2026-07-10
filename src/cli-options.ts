import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type FrontDoorCommand = "help" | "version";

interface PackageMetadata {
  readonly version?: string;
}

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function frontDoorCommand(args: readonly string[]): FrontDoorCommand | undefined {
  if (args[0] === "--help" || args[0] === "-h") return "help";
  if (args[0] === "--version" || args[0] === "-v") return "version";
  return undefined;
}

export function renderFrontDoorCommand(command: FrontDoorCommand): string {
  if (command === "version") return readPackageMetadata().version ?? "unknown";

  return [
    "Usage: opencandle [command]",
    "",
    "Commands:",
    "  (default)                         Start the interactive terminal TUI",
    "  gui                               Start the local GUI",
    "  monitor [--once]                  Run local alert/report automation",
    "  doctor [--json|--full|--sessions|--enable <provider>]",
    "                                    Check OpenCandle health",
    "  install <source> [-l]             Install a package",
    "  remove|uninstall <source> [-l]    Remove a package",
    "  list                              List installed packages",
    "  update [source]                   Update packages",
  ].join("\n");
}

function readPackageMetadata(): PackageMetadata {
  return require(resolve(packageRoot, "package.json")) as PackageMetadata;
}
