import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedGuiServerEnv } from "../../support/gui/server.js";

describe("isolatedGuiServerEnv", () => {
  const homeDir = join("/tmp", "opencandle-gui-integration-test");
  const parentEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/Users/developer",
    USERPROFILE: "C:\\Users\\developer",
    OPENCANDLE_HOME: "/Users/developer/.opencandle",
    PI_CODING_AGENT_DIR: "/Users/developer/.pi/agent",
    PI_CODING_AGENT_SESSION_DIR: "/Users/developer/.pi/agent/sessions",
  };

  it("does not leak the developer's Pi or OpenCandle state directories", () => {
    const env = isolatedGuiServerEnv({ homeDir, port: 4321, parentEnv });

    expect(env.HOME).toBe(join(homeDir, "home"));
    expect(env.USERPROFILE).toBe(join(homeDir, "home"));
    expect(env.OPENCANDLE_HOME).toBe(join(homeDir, "opencandle"));
    expect(env.PI_CODING_AGENT_DIR).toBe(join(homeDir, "home", ".pi", "agent"));
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBe("");
    for (const value of Object.values(env)) {
      expect(value ?? "").not.toContain("/Users/developer");
      expect(value ?? "").not.toContain("C:\\Users\\developer");
    }
    expect(env.PATH).toBe("/usr/bin");
    expect(env.OPENCANDLE_GUI_PORT).toBe("4321");
  });

  it("lets an explicit test override win over the isolation baseline", () => {
    const agentDir = join(homeDir, "custom-agent");
    const env = isolatedGuiServerEnv({
      homeDir,
      port: 4321,
      parentEnv,
      overrides: { PI_CODING_AGENT_DIR: agentDir },
    });
    expect(env.PI_CODING_AGENT_DIR).toBe(agentDir);
  });
});
