// Cross-platform npm/npx invocation for scripts that run with `shell: false`.
//
// On Windows `npm` and `npx` are `.cmd` shims. Node's security hardening
// (April 2024) refuses to spawn `.cmd`/`.bat` files without an interpreter, so
// a `shell: false` spawn of `npm.cmd` fails with EINVAL. The hardening exists
// to stop argument-injection, so the fix is not to re-enable a shell: it is to
// run npm's own JavaScript entrypoint directly through `process.execPath`,
// which keeps every argument literal. On POSIX the bare `npm`/`npx` commands
// are real executables and are left untouched.

import { existsSync } from "node:fs";
import { win32 } from "node:path";

const CLI_FILENAMES = {
  npm: "npm-cli.js",
  npx: "npx-cli.js",
};

function assertKnownTool(tool) {
  if (!Object.hasOwn(CLI_FILENAMES, tool)) {
    throw new Error(`unknown npm CLI tool: ${tool}`);
  }
}

/**
 * Ordered candidate paths for a tool's JavaScript entrypoint. Only meaningful
 * on Windows, where the entrypoint must be located explicitly; the list covers
 * the running npm (`npm_execpath`), the standard Node installation layout, and
 * npm global prefixes.
 */
export function npmCliCandidatePaths(
  tool,
  { platform = process.platform, execPath = process.execPath, env = process.env } = {},
) {
  assertKnownTool(tool);
  if (platform !== "win32") return [];

  const path = win32;
  const filename = CLI_FILENAMES[tool];
  const directories = [];

  if (typeof env.npm_execpath === "string" && env.npm_execpath) {
    directories.push(path.dirname(env.npm_execpath));
  }

  const execDir = path.dirname(execPath);
  directories.push(path.join(execDir, "node_modules", "npm", "bin"));
  directories.push(path.join(execDir, "..", "lib", "node_modules", "npm", "bin"));

  for (const key of ["npm_config_global_prefix", "npm_config_prefix"]) {
    const prefix = env[key];
    if (typeof prefix === "string" && prefix) {
      directories.push(path.join(prefix, "node_modules", "npm", "bin"));
      directories.push(path.join(prefix, "lib", "node_modules", "npm", "bin"));
    }
  }

  const candidates = [];
  for (const directory of directories) {
    const candidate = path.join(directory, filename);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Resolve a `{ command, args }` prefix that invokes `tool` without a shell.
 *
 * On POSIX this is the bare `npm`/`npx` command. On Windows it is
 * `process.execPath` plus the npm CLI JavaScript entrypoint, so the caller's
 * `shell: false` spawn works and no argument is ever re-parsed by cmd.exe.
 * When no entrypoint exists the call fails loudly instead of silently falling
 * back to an unspawnable `.cmd` shim.
 */
export function resolveNpmCommand(
  tool,
  {
    platform = process.platform,
    execPath = process.execPath,
    env = process.env,
    exists = existsSync,
  } = {},
) {
  assertKnownTool(tool);
  if (platform !== "win32") {
    return { command: tool, args: [] };
  }

  const candidates = npmCliCandidatePaths(tool, { platform, execPath, env });
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { command: execPath, args: [candidate] };
    }
  }

  throw new Error(
    `Cannot locate the ${tool} JavaScript entrypoint on Windows; refusing to fall back to a .cmd shim without a shell. Tried:\n- ${candidates.join("\n- ")}`,
  );
}

/**
 * Build the full command and argument array for one `tool` call. Arguments are
 * appended unchanged, so paths containing spaces or shell metacharacters stay
 * single, literal array elements.
 */
export function buildNpmInvocation(tool, args, options = {}) {
  const resolved = resolveNpmCommand(tool, options);
  return { command: resolved.command, args: [...resolved.args, ...args] };
}
