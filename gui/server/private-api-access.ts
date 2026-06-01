export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (remoteAddress == null || remoteAddress === "") return false;
  return (
    remoteAddress === "::1" ||
    remoteAddress === "localhost" ||
    remoteAddress.startsWith("127.") ||
    remoteAddress.startsWith("::ffff:127.")
  );
}
