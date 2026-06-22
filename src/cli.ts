#!/usr/bin/env node
import "./infra/node-version.js";
import { ensureOpenCandleNativeDependencies } from "./infra/native-dependencies.js";

if (process.argv[2] === "doctor") {
  const [{ loadEnv }, { handleDoctorCommand }, { getAgentDir }] = await Promise.all([
    import("./config.js"),
    import("./doctor/cli-command.js"),
    import("@earendil-works/pi-coding-agent"),
  ]);
  loadEnv();
  await handleDoctorCommand(process.argv.slice(2), process.cwd(), getAgentDir());
} else {
  await ensureOpenCandleNativeDependencies();
  await import("./cli-main.js");
}
