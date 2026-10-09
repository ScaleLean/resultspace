// One error type for everything a caller can get wrong. Surfaces turn `code` into a status.
export type ErrorCode = "not_found" | "forbidden" | "invalid" | "conflict";

export class RsError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const notFound = (what: string) => new RsError("not_found", `no ${what}`);
export const invalid = (message: string) => new RsError("invalid", message);
export const conflict = (message: string) => new RsError("conflict", message);
export const forbidden = (message: string) => new RsError("forbidden", message);
