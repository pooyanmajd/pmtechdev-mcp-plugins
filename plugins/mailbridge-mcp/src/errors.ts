export const MAILBRIDGE_ERROR_CODES = [
  "UNSUPPORTED_PLATFORM",
  "AUTOMATION_DENIED",
  "MAIL_NOT_CONFIGURED",
  "NOT_FOUND",
  "AMBIGUOUS_ID",
  "READ_ONLY",
  "CONFIRMATION_UNAVAILABLE",
  "SEND_NOT_CONFIRMED",
  "AUTOMATION_BUSY",
  "MUTATION_OUTCOME_UNKNOWN",
  "SEND_REJECTED",
  "SEND_CONTENT_CHANGED",
  "SEND_TARGET_CHANGED",
  "TIMEOUT",
  "MAIL_AUTOMATION_ERROR",
  "INVALID_INPUT",
  "INVALID_CONFIG",
  "ACCOUNT_NOT_ALLOWED",
  "ATTACHMENT_TOO_LARGE",
  "UNSUPPORTED_ATTACHMENT",
  "RESPONSE_TOO_LARGE",
  "LOCAL_PREFERENCES_WRITE_FAILED",
  "CONFIRMATION_BUSY",
] as const;

export type MailbridgeErrorCode = (typeof MAILBRIDGE_ERROR_CODES)[number];

const SAFE_ERROR_MESSAGES: Readonly<Record<MailbridgeErrorCode, string>> = Object.freeze({
  UNSUPPORTED_PLATFORM: "Mailbridge requires macOS with Apple Mail available.",
  AUTOMATION_DENIED: "Apple Mail automation access was denied. Review macOS Automation permissions.",
  MAIL_NOT_CONFIGURED: "No eligible Apple Mail account is configured.",
  NOT_FOUND: "The requested Mail item was not found or is not accessible.",
  AMBIGUOUS_ID: "The supplied identifier matches more than one Mail item.",
  READ_ONLY: "This operation is disabled by the current Mailbridge mode.",
  CONFIRMATION_UNAVAILABLE: "The MCP client cannot present the required send confirmation.",
  SEND_NOT_CONFIRMED: "No explicit approval was received for this send; no message was submitted.",
  AUTOMATION_BUSY: "Mailbridge has too many automation operations queued. Wait before retrying.",
  MUTATION_OUTCOME_UNKNOWN: "Mail did not confirm the modifying operation. Inspect Mail before retrying.",
  SEND_REJECTED: "Apple Mail did not accept the message for sending.",
  SEND_CONTENT_CHANGED: "Apple Mail changed the approved outgoing content before sending.",
  SEND_TARGET_CHANGED: "Apple Mail resolved reply recipients that differ from the approved recipients.",
  TIMEOUT: "Apple Mail did not complete the operation before the configured timeout.",
  MAIL_AUTOMATION_ERROR: "Apple Mail could not complete the requested operation.",
  INVALID_INPUT: "The tool input is invalid.",
  INVALID_CONFIG: "Mailbridge configuration is invalid.",
  ACCOUNT_NOT_ALLOWED: "The requested account is not allowed by Mailbridge configuration.",
  ATTACHMENT_TOO_LARGE: "The attachment exceeds the configured response limit.",
  UNSUPPORTED_ATTACHMENT: "Apple Mail cannot provide this attachment safely.",
  RESPONSE_TOO_LARGE: "Apple Mail returned more data than Mailbridge permits.",
  LOCAL_PREFERENCES_WRITE_FAILED: "Mailbridge could not save local access preferences to disk.",
  CONFIRMATION_BUSY: "Mailbridge has too many send confirmations already pending. Wait before retrying.",
});

export class MailbridgeError extends Error {
  public constructor(
    public readonly code: MailbridgeErrorCode,
    message: string = SAFE_ERROR_MESSAGES[code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MailbridgeError";
  }
}

function hasStringCode(error: unknown): error is { readonly code: string } {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string";
}

function isMailbridgeErrorCode(value: string): value is MailbridgeErrorCode {
  return (MAILBRIDGE_ERROR_CODES as readonly string[]).includes(value);
}

/** Converts all bridge and runtime failures to a stable, non-sensitive public error. */
export function toPublicError(error: unknown): MailbridgeError {
  if (error instanceof MailbridgeError) {
    return new MailbridgeError(error.code);
  }

  if (hasStringCode(error)) {
    if (isMailbridgeErrorCode(error.code)) {
      return new MailbridgeError(error.code);
    }
    if (error.code === "INVALID_ID" || error.code === "INVALID_REQUEST") {
      return new MailbridgeError("INVALID_INPUT");
    }
  }

  return new MailbridgeError("MAIL_AUTOMATION_ERROR");
}
