import { describe, expect, it } from "vitest";
import { getRuntimeSurfaceCapabilities } from "../../../src/runtime/runtime-surface.js";

describe("runtime surface capabilities", () => {
  it("keeps local TUI on the native in-process runtime", () => {
    expect(getRuntimeSurfaceCapabilities("local_tui")).toEqual({
      surface: "local_tui",
      runtime: "native_node",
      sessionPersistence: "pi_filesystem",
      statePersistence: "native_sqlite",
      transport: "in_process",
      providerPolicy: "local",
      backgroundExecution: true,
      installable: false,
    });
  });

  it("keeps local web on its trusted loopback runtime", () => {
    expect(getRuntimeSurfaceCapabilities("local_web")).toEqual({
      surface: "local_web",
      runtime: "native_node",
      sessionPersistence: "pi_filesystem",
      statePersistence: "native_sqlite",
      transport: "loopback",
      providerPolicy: "local",
      backgroundExecution: true,
      installable: false,
    });
  });

  it("makes hosted web's browser boundaries explicit", () => {
    expect(getRuntimeSurfaceCapabilities("hosted_web")).toEqual({
      surface: "hosted_web",
      runtime: "browser_hosted_node",
      sessionPersistence: "opfs_pi_jsonl",
      statePersistence: "opfs_wasm_sqlite",
      transport: "browser_rpc",
      providerPolicy: "browser_direct_only",
      backgroundExecution: false,
      installable: true,
    });
  });
});
