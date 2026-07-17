import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { z } from "zod";

import { MAILBRIDGE_MODES, type MailbridgeMode } from "./config.js";

const LOCAL_PREFERENCES_SCHEMA_VERSION = 1;
const MAX_ALLOWED_ACCOUNTS = 50;

// Mirrors config.ts's own MAILBRIDGE_ALLOWED_ACCOUNTS pattern exactly, so a value
// round-tripped through overlayLocalPreferences() can never fail loadConfig's parsing.
const ALLOWED_ACCOUNTS_EMAIL_PATTERN = /^[^\s<>@,]+@[^\s<>@,]+$/;

// Exported so callers (e.g. the mailbridge_set_access_preferences tool schema) validate
// proposed addresses with the exact same rule this module and config.ts both enforce.
export const allowlistEmail = z.string().trim().toLowerCase().min(1).max(320).regex(ALLOWED_ACCOUNTS_EMAIL_PATTERN);

export const MAX_LOCAL_ALLOWED_ACCOUNTS = MAX_ALLOWED_ACCOUNTS;

const localPreferencesFileSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_PREFERENCES_SCHEMA_VERSION),
    mode: z.enum(MAILBRIDGE_MODES),
    allowedAccounts: z.array(allowlistEmail).min(1).max(MAX_ALLOWED_ACCOUNTS),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export interface LocalMailbridgePreferences {
  readonly mode: MailbridgeMode;
  readonly allowedAccounts: readonly string[];
  readonly updatedAt: string;
}

export interface LocalPreferencesEnvOverrides {
  readonly mode: boolean;
  readonly allowedAccounts: boolean;
}

export interface LocalPreferencesContext {
  readonly path: string;
  readonly envOverrides: LocalPreferencesEnvOverrides;
}

export interface ReadLocalPreferencesResult {
  readonly preferences: LocalMailbridgePreferences | undefined;
  readonly diagnostic: string | undefined;
}

export interface WriteLocalPreferencesInput {
  readonly mode: MailbridgeMode;
  readonly allowedAccounts: readonly string[];
}

export function isEnvValueSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

export function resolveLocalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const xdg = env.XDG_CONFIG_HOME;
  const baseDir =
    isEnvValueSet(xdg) && path.isAbsolute(xdg as string)
      ? (xdg as string)
      : path.join(homeDir, "Library", "Application Support");
  return path.join(baseDir, "mailbridge-mcp", "preferences.json");
}

export function defaultLocalPreferencesContext(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): LocalPreferencesContext {
  return {
    path: resolveLocalConfigPath(env, homeDir),
    envOverrides: {
      mode: isEnvValueSet(env.MAILBRIDGE_MODE),
      allowedAccounts: isEnvValueSet(env.MAILBRIDGE_ALLOWED_ACCOUNTS),
    },
  };
}

export function overlayLocalPreferences(
  env: NodeJS.ProcessEnv,
  preferences: LocalMailbridgePreferences | undefined,
): NodeJS.ProcessEnv {
  if (preferences === undefined) {
    return { ...env };
  }
  return {
    ...env,
    MAILBRIDGE_MODE: isEnvValueSet(env.MAILBRIDGE_MODE) ? env.MAILBRIDGE_MODE : preferences.mode,
    MAILBRIDGE_ALLOWED_ACCOUNTS: isEnvValueSet(env.MAILBRIDGE_ALLOWED_ACCOUNTS)
      ? env.MAILBRIDGE_ALLOWED_ACCOUNTS
      : preferences.allowedAccounts.join(","),
  };
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readLocalPreferences(filePath: string): Promise<ReadLocalPreferencesResult> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = localPreferencesFileSchema.parse(JSON.parse(raw));
    return {
      preferences: {
        mode: parsed.mode,
        allowedAccounts: parsed.allowedAccounts,
        updatedAt: parsed.updatedAt,
      },
      diagnostic: undefined,
    };
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return { preferences: undefined, diagnostic: undefined };
    }
    return {
      preferences: undefined,
      diagnostic: "The saved local preferences file could not be read (corrupt or inaccessible); using built-in defaults until it's fixed or replaced.",
    };
  }
}

export async function writeLocalPreferences(
  filePath: string,
  input: WriteLocalPreferencesInput,
  now: () => string = () => new Date().toISOString(),
): Promise<LocalMailbridgePreferences> {
  const normalizedAccounts = [...new Set(input.allowedAccounts.map((account) => account.trim().toLowerCase()))];
  const record = localPreferencesFileSchema.parse({
    schemaVersion: LOCAL_PREFERENCES_SCHEMA_VERSION,
    mode: input.mode,
    allowedAccounts: normalizedAccounts,
    updatedAt: now(),
  });

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);

  const tempPath = path.join(dir, `.preferences-${randomUUID()}.json.tmp`);
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, filePath);
  } catch (error: unknown) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    mode: record.mode,
    allowedAccounts: record.allowedAccounts,
    updatedAt: record.updatedAt,
  };
}
