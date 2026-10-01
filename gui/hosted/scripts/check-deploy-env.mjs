// Refuses a hosted deploy whose build would embed VITE_WEBCONTAINER_API_KEY.
// Vite reads the shell plus .env, .env.local, .env.production and
// .env.production.local from this package directory, and inlines VITE_* values
// into the public bundle. See README.md "WebContainer API key status".
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const KEY = "VITE_WEBCONTAINER_API_KEY";
const OPT_IN = "OPENCANDLE_ALLOW_WEBCONTAINER_API_KEY";
const hostedDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
// The files Vite loads for `vite build` (mode "production").
const PRODUCTION_ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];

export function findDeployEnvProblems({ env = process.env, envDir = hostedDir } = {}) {
  if (env[OPT_IN] === "1") return [];
  const problems = [];
  if (env[KEY]) problems.push(`${KEY} is set in the deploy shell.`);
  for (const file of PRODUCTION_ENV_FILES) {
    const path = join(envDir, file);
    if (existsSync(path) && parseEnv(readFileSync(path, "utf8"))[KEY]) {
      problems.push(`${KEY} is set in ${path}.`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findDeployEnvProblems();
  if (problems.length > 0) {
    console.error(
      [
        "Hosted deploy refused: the build would ship a WebContainer API key in the public bundle.",
        ...problems.map((problem) => `  - ${problem}`),
        `Unset it for production builds, or set ${OPT_IN}=1 only with a StackBlitz license for web.opencandle.app.`,
      ].join("\n"),
    );
    process.exit(1);
  }
}
