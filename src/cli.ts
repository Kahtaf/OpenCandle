#!/usr/bin/env node
import "./infra/node-version.js";
import { ensureOpenCandleNativeDependencies } from "./infra/native-dependencies.js";

await ensureOpenCandleNativeDependencies();
await import("./cli-main.js");
