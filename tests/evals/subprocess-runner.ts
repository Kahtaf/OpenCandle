import { spawnSync } from "node:child_process";

export interface SubprocessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs?: number;
  errorMessage?: string;
}

export function runSubprocess(
  command: string,
  args: string[],
  options: {
    workdir: string;
    stdio: "inherit" | "pipe";
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): SubprocessResult {
  const result = spawnSync(command, args, {
    cwd: options.workdir,
    env: options.env ?? process.env,
    encoding: "utf-8",
    stdio: options.stdio,
    timeout: options.timeoutMs,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;

  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    timedOut: error?.code === "ETIMEDOUT",
    timeoutMs: options.timeoutMs,
    errorMessage: error?.message,
  };
}
