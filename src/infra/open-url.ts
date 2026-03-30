import { execFile } from "node:child_process";

export function openInBrowser(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let command: string;
    let args: string[];

    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = execFile(command, args, { timeout: 5000 }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    child.unref();
  });
}
