export type MailBridgeErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "AUTOMATION_DENIED"
  | "MAIL_NOT_CONFIGURED"
  | "NOT_FOUND"
  | "AMBIGUOUS_ID"
  | "INVALID_ID"
  | "INVALID_REQUEST"
  | "ACCOUNT_NOT_ALLOWED"
  | "ATTACHMENT_TOO_LARGE"
  | "UNSUPPORTED_ATTACHMENT"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "MAIL_AUTOMATION_ERROR";

export interface SerializedMailBridgeError {
  code: MailBridgeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** A stable, caller-safe error emitted by the Mail automation boundary. */
export class MailBridgeError extends Error {
  readonly code: MailBridgeErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: MailBridgeErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MailBridgeError";
    this.code = code;
    this.details = details;
  }
}

const ERROR_CODES = new Set<MailBridgeErrorCode>([
  "UNSUPPORTED_PLATFORM",
  "AUTOMATION_DENIED",
  "MAIL_NOT_CONFIGURED",
  "NOT_FOUND",
  "AMBIGUOUS_ID",
  "INVALID_ID",
  "INVALID_REQUEST",
  "ACCOUNT_NOT_ALLOWED",
  "ATTACHMENT_TOO_LARGE",
  "UNSUPPORTED_ATTACHMENT",
  "TIMEOUT",
  "RESPONSE_TOO_LARGE",
  "MAIL_AUTOMATION_ERROR",
]);

export function isMailBridgeErrorCode(value: unknown): value is MailBridgeErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value as MailBridgeErrorCode);
}

export function asMailBridgeError(error: unknown): MailBridgeError {
  if (error instanceof MailBridgeError) return error;
  return new MailBridgeError(
    "MAIL_AUTOMATION_ERROR",
    "Mail.app automation failed.",
    undefined,
    error instanceof Error ? { cause: error } : undefined,
  );
}
