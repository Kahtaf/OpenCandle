import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { journeyGuiServerEnv } from "../../support/gui-journey/journey-harness.js";

describe("journeyGuiServerEnv", () => {
  const root = join("/tmp", "oc-gui-journey-env-test");
  const agentDir = join(root, "agent");
  const parentEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/Users/developer",
    USERPROFILE: "C:\\Users\\developer",
    OPENCANDLE_HOME: "/Users/developer/.opencandle",
    PI_CODING_AGENT_DIR: "/Users/developer/.pi/agent",
    PI_CODING_AGENT_SESSION_DIR: "/Users/developer/.pi/agent/sessions",
  };

  function env() {
    return journeyGuiServerEnv({
      root,
      agentDir,
      port: 4567,
      modelBaseUrl: "http://127.0.0.1:1111",
      auxBaseUrl: "http://127.0.0.1:2222",
      unexpectedLog: join(root, "unexpected.log"),
      parentEnv,
    });
  }

  it("does not leak the developer's Pi or OpenCandle state directories into the journey GUI", () => {
    const childEnv = env();

    expect(childEnv.HOME).toBe(join(root, "home"));
    expect(childEnv.USERPROFILE).toBe(join(root, "home"));
    expect(childEnv.OPENCANDLE_HOME).toBe(join(root, "opencandle"));
    expect(childEnv.PI_CODING_AGENT_DIR).toBe(agentDir);
    expect(childEnv.PI_CODING_AGENT_SESSION_DIR).toBe("");
    for (const value of Object.values(childEnv)) {
      expect(value ?? "").not.toContain("/Users/developer");
      expect(value ?? "").not.toContain("C:\\Users\\developer");
    }
    expect(childEnv.PATH).toBe("/usr/bin");
  });

  it("keeps the journey's own wiring", () => {
    const childEnv = env();
    expect(childEnv).toMatchObject({
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      OPENCANDLE_GUI_HOST: "127.0.0.1",
      OPENCANDLE_GUI_PORT: "4567",
      OPENCANDLE_AUTOMATION_HEARTBEAT_MS: "3600000",
      OC_GUI_JOURNEY_MODEL_BASE_URL: "http://127.0.0.1:1111",
      OC_GUI_JOURNEY_AUX_BASE_URL: "http://127.0.0.1:2222",
      OC_GUI_JOURNEY_UNEXPECTED_LOG: join(root, "unexpected.log"),
    });
  });
});
