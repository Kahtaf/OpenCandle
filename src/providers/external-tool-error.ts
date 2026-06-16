export class ExternalToolError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ExternalToolError";
  }
}

export class ExternalToolNotInstalled extends Error {
  constructor(
    public readonly toolName: string,
    public readonly installCmd: string,
  ) {
    super(`${toolName} is not installed. Install it with: ${installCmd}`);
    this.name = "ExternalToolNotInstalled";
  }
}
