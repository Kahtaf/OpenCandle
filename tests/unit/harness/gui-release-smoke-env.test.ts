import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseSmokeServerEnv } from "../../support/gui/server.js";

describe("releaseSmokeServerEnv", () => {
  const smokeHome = join("/tmp", "opencandle-gui-release-smoke-test");
  const parentEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/Users/developer",
    USERPROFILE: "C:\\Users\\developer",
    OPENCANDLE_HOME: "/Users/developer/.opencandle",
    PI_CODING_AGENT_DIR: "/Users/developer/.pi/agent",
    PI_CODING_AGENT_SESSION_DIR: "/Users/developer/.pi/agent/sessions",
    OPENAI_API_KEY: "sk-host-key",
  };

  function env() {
    return releaseSmokeServerEnv({
      smokeHome,
      port: 4321,
      probeBaseUrl: "http://127.0.0.1:9999",
      parentEnv,
    });
  }

  it("does not leak the developer's Pi or OpenCandle state into the smoke GUI", () => {
    const childEnv = env();
    expect(childEnv.HOME).toBe(join(smokeHome, "home"));
    expect(childEnv.USERPROFILE).toBe(join(smokeHome, "home"));
    expect(childEnv.OPENCANDLE_HOME).toBe(join(smokeHome, "opencandle"));
    expect(childEnv.PI_CODING_AGENT_DIR).toBe(join(smokeHome, "home", ".pi", "agent"));
    expect(childEnv.PI_CODING_AGENT_SESSION_DIR).toBe("");
    for (const value of Object.values(childEnv)) {
      expect(value ?? "").not.toContain("/Users/developer");
      expect(value ?? "").not.toContain("C:\\Users\\developer");
    }
    expect(childEnv.OPENAI_API_KEY).toBe("");
    expect(childEnv.PATH).toBe("/usr/bin");
  });

  it("keeps the smoke's own wiring", () => {
    expect(env()).toMatchObject({
      OPENCANDLE_GUI_HOST: "127.0.0.1",
      OPENCANDLE_GUI_PORT: "4321",
      OPENCANDLE_MODEL_KEY_PROBE_BASE_URL: "http://127.0.0.1:9999",
    });
  });
});
