#!/usr/bin/env node
import { ensureOpenCandleNativeDependencies } from "./infra/native-dependencies.js";
import { assertSupportedNodeVersion } from "./infra/node-version.js";

if (process.argv[2] === "doctor") {
  const [{ loadEnv }, { handleDoctorCommand }, { getAgentDir }] = await Promise.all([
    import("./config.js"),
    import("./doctor/cli-command.js"),
    import("@earendil-works/pi-coding-agent"),
  ]);
  loadEnv();
  await handleDoctorCommand(process.argv.slice(2), process.cwd(), getAgentDir());
} else {
  assertSupportedNodeVersion();
  await ensureOpenCandleNativeDependencies();
  await import("./cli-main.js");
}
