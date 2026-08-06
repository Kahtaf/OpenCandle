import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export function assertValidToolArguments(parameters: TSchema, args: unknown): void {
  if (Value.Check(parameters, args)) return;

  const errors = [...Value.Errors(parameters, args)]
    .map((error) => `${error.path || "/"} ${error.message}`)
    .join("; ");
  throw new Error(errors || "Invalid tool arguments");
}
