import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000_000;

export interface ExternalToolCommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExternalToolCommandOptions {
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
}

interface CandidateOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
}

export function getExternalToolCommandCandidates(
  command: string,
  options: CandidateOptions = {},
): string[] {
  if (isPathLikeCommand(command)) return [command];

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const candidates = [command];
  const binDirs = [
    env.OPENCANDLE_EXTERNAL_TOOL_BIN_DIR,
    env.UV_TOOL_BIN_DIR,
    env.XDG_BIN_HOME,
    home ? join(home, ".local", "bin") : undefined,
  ];

  for (const dir of binDirs) {
    if (!dir) continue;
    for (const executable of commandNames(command, platform)) {
      candidates.push(join(dir, executable));
    }
  }

  return [...new Set(candidates)];
}

export async function runExternalToolCommand(
  command: string,
  args: readonly string[],
  options: ExternalToolCommandOptions = {},
): Promise<ExternalToolCommandResult> {
  const uvToolBinDirs = await resolveUvToolBinDirs(options);
  const candidates = [
    ...getExternalToolCommandCandidates(command),
    ...uvToolBinDirs.flatMap((dir) =>
      commandNames(command, process.platform).map((executable) => join(dir, executable)),
    ),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);
  const existingCandidates = candidates.filter(
    (candidate) => candidate === command || existsSync(candidate),
  );
  return runCandidate(
    existingCandidates.length > 0 ? existingCandidates : [command],
    args,
    options,
  );
}

async function resolveUvToolBinDirs(
  options: ExternalToolCommandOptions,
): Promise<readonly string[]> {
  try {
    const result = await spawnCommand("uv", ["tool", "dir", "--bin"], {
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 2_000),
      maxOutputChars: 4_000,
    });
    if (result.code !== 0) return [];
    const binDir = result.stdout.trim();
    return binDir ? [binDir] : [];
  } catch {
    return [];
  }
}

function runCandidate(
  candidates: readonly string[],
  args: readonly string[],
  options: ExternalToolCommandOptions,
): Promise<ExternalToolCommandResult> {
  const [command, ...fallbacks] = candidates;
  return spawnCommand(command, args, options).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" && fallbacks.length > 0) {
      return runCandidate(fallbacks, args, options);
    }
    throw err;
  });
}

function spawnCommand(
  command: string,
  args: readonly string[],
  options: ExternalToolCommandOptions,
): Promise<ExternalToolCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, maxOutputChars);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, maxOutputChars);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function isPathLikeCommand(command: string): boolean {
  return (
    isAbsolute(command) || command.includes("/") || command.includes("\\") || command.includes(sep)
  );
}

function commandNames(command: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [command];

  const names = [command];
  const pathExt = process.env.PATHEXT?.split(delimiter) ?? [".EXE", ".CMD", ".BAT"];
  for (const ext of pathExt) {
    if (!command.toLowerCase().endsWith(ext.toLowerCase())) {
      names.push(`${command}${ext.toLowerCase()}`);
    }
  }
  return names;
}
