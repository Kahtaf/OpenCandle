import { defineConfig } from "vitest/config";
import {
  agentToolsProject,
  evalsProject,
  guiBrowserProject,
  guiReleaseProject,
  siteProject,
  unitProject,
} from "./vitest.projects.js";

export default defineConfig({
  test: {
    projects: [
      unitProject,
      siteProject,
      agentToolsProject,
      evalsProject,
      guiBrowserProject,
      guiReleaseProject,
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
