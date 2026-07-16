export const MAILBRIDGE_MODES = ["read-only", "drafts", "full"] as const;

export type MailbridgeMode = (typeof MAILBRIDGE_MODES)[number];

export interface MailbridgeConfig {
  readonly mode: MailbridgeMode;
  readonly allowedAccounts: readonly string[] | undefined;
  readonly maxResults: number;
  readonly maxBodyChars: number;
  readonly timeoutMs: number;
}

export const CONFIG_LIMITS = Object.freeze({
  maxResults: 100,
  maxBodyChars: 500_000,
  timeoutMs: 120_000,
});

export const CONFIG_DEFAULTS = Object.freeze({
  mode: "read-only" as const,
  maxResults: 25,
  maxBodyChars: 100_000,
  timeoutMs: 20_000,
});

export class ConfigError extends Error {
  public readonly code = "INVALID_CONFIG";

  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseMode(value: string | undefined): MailbridgeMode {
  if (value === undefined || value.trim() === "") {
    return CONFIG_DEFAULTS.mode;
  }

  if ((MAILBRIDGE_MODES as readonly string[]).includes(value)) {
    return value as MailbridgeMode;
  }

  throw new ConfigError("MAILBRIDGE_MODE must be read-only, drafts, or full.");
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ConfigError(`${name} exceeds its supported maximum of ${maximum}.`);
  }

  return parsed;
}

function parseAllowedAccounts(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const accounts = value
    .split(",")
    .map((account) => account.trim().toLowerCase())
    .filter((account) => account.length > 0);

  if (accounts.length === 0) {
    throw new ConfigError("MAILBRIDGE_ALLOWED_ACCOUNTS must contain at least one email address.");
  }

  const simpleEmail = /^[^\s<>@,]+@[^\s<>@,]+$/;
  if (accounts.some((account) => !simpleEmail.test(account))) {
    throw new ConfigError("MAILBRIDGE_ALLOWED_ACCOUNTS contains an invalid email address.");
  }

  return [...new Set(accounts)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MailbridgeConfig {
  return {
    mode: parseMode(env.MAILBRIDGE_MODE),
    allowedAccounts: parseAllowedAccounts(env.MAILBRIDGE_ALLOWED_ACCOUNTS),
    maxResults: parsePositiveInteger(
      "MAILBRIDGE_MAX_RESULTS",
      env.MAILBRIDGE_MAX_RESULTS,
      CONFIG_DEFAULTS.maxResults,
      CONFIG_LIMITS.maxResults,
    ),
    maxBodyChars: parsePositiveInteger(
      "MAILBRIDGE_MAX_BODY_CHARS",
      env.MAILBRIDGE_MAX_BODY_CHARS,
      CONFIG_DEFAULTS.maxBodyChars,
      CONFIG_LIMITS.maxBodyChars,
    ),
    timeoutMs: parsePositiveInteger(
      "MAILBRIDGE_TIMEOUT_MS",
      env.MAILBRIDGE_TIMEOUT_MS,
      CONFIG_DEFAULTS.timeoutMs,
      CONFIG_LIMITS.timeoutMs,
    ),
  };
}
