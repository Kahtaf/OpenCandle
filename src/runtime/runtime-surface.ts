export type RuntimeSurface = "local_tui" | "local_web" | "hosted_web";

export interface RuntimeSurfaceCapabilities {
  surface: RuntimeSurface;
  runtime: "native_node" | "browser_hosted_node";
  sessionPersistence: "pi_filesystem" | "opfs_pi_jsonl";
  statePersistence: "native_sqlite" | "opfs_wasm_sqlite";
  transport: "in_process" | "loopback" | "browser_rpc";
  providerPolicy: "local" | "browser_direct_only";
  backgroundExecution: boolean;
  installable: boolean;
}

const CAPABILITIES = {
  local_tui: {
    surface: "local_tui",
    runtime: "native_node",
    sessionPersistence: "pi_filesystem",
    statePersistence: "native_sqlite",
    transport: "in_process",
    providerPolicy: "local",
    backgroundExecution: true,
    installable: false,
  },
  local_web: {
    surface: "local_web",
    runtime: "native_node",
    sessionPersistence: "pi_filesystem",
    statePersistence: "native_sqlite",
    transport: "loopback",
    providerPolicy: "local",
    backgroundExecution: true,
    installable: false,
  },
  hosted_web: {
    surface: "hosted_web",
    runtime: "browser_hosted_node",
    sessionPersistence: "opfs_pi_jsonl",
    statePersistence: "opfs_wasm_sqlite",
    transport: "browser_rpc",
    providerPolicy: "browser_direct_only",
    backgroundExecution: false,
    installable: true,
  },
} as const satisfies Record<RuntimeSurface, RuntimeSurfaceCapabilities>;

export function getRuntimeSurfaceCapabilities(surface: RuntimeSurface): RuntimeSurfaceCapabilities {
  return { ...CAPABILITIES[surface] };
}
