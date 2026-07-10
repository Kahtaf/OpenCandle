#!/usr/bin/env node
import { frontDoorCommand, renderFrontDoorCommand } from "./cli-options.js";
import { ensureOpenCandleNativeDependencies } from "./infra/native-dependencies.js";
import { assertSupportedNodeVersion } from "./infra/node-version.js";

const args = process.argv.slice(2);
const command = frontDoorCommand(args);

if (command) {
  console.log(renderFrontDoorCommand(command));
} else if (args[0] === "doctor") {
  const [{ loadEnv }, { handleDoctorCommand }, { getAgentDir }] = await Promise.all([
    import("./config.js"),
    import("./doctor/cli-command.js"),
    import("@earendil-works/pi-coding-agent"),
  ]);
  loadEnv();
  await handleDoctorCommand(args, process.cwd(), getAgentDir());
} else {
  assertSupportedNodeVersion();
  await ensureOpenCandleNativeDependencies();
  await import("./cli-main.js");
}
