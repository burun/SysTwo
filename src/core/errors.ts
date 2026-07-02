export class SysTwoError extends Error {
  constructor(
    message: string,
    public readonly code = "SYSTWO_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SysTwoError";
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
