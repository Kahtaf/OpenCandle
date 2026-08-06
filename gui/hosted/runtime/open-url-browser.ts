export async function openInBrowser(): Promise<void> {
  throw new Error(
    "Opening an external browser process is unavailable in hosted OpenCandle",
  );
}
