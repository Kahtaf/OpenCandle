function unavailable(): never {
  throw new Error("Child processes are unavailable in hosted OpenCandle");
}

export const exec = unavailable;
export const execFile = unavailable;
export const execFileSync = unavailable;
export const execSync = unavailable;
export const spawn = unavailable;
export const spawnSync = unavailable;
