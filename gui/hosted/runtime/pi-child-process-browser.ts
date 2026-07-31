function unavailable(): never {
  throw new Error("Child processes are unavailable in hosted OpenCandle");
}

export const spawnProcess = unavailable;
export const spawnProcessSync = unavailable;
export const waitForChildProcess = unavailable;
