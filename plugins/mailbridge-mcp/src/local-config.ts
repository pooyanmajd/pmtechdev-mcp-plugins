import { randomUUID } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

import { z } from "zod";

import { MAILBRIDGE_MODES, type MailbridgeMode } from "./config.js";

const LOCAL_PREFERENCES_SCHEMA_VERSION = 1;
const MAX_ALLOWED_ACCOUNTS = 50;
// The file only ever holds {schemaVersion, mode, allowedAccounts (<=50 short emails),
// updatedAt} — realistically under 5 KB. This bound exists so a large corrupt or
// maliciously placed file cannot be loaded fully into memory before validation.
const MAX_PREFERENCES_FILE_BYTES = 64 * 1024;
const UNREADABLE_DIAGNOSTIC =
  "The saved local preferences file could not be read (corrupt or inaccessible); using built-in defaults until it's fixed or replaced.";

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

async function lstatIfExists(targetPath: string): Promise<Stats | undefined> {
  try {
    return await fs.lstat(targetPath);
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

function isOwnedByCurrentProcess(stat: Stats): boolean {
  // process.getuid is undefined on Windows; this module only ever runs on macOS
  // (the whole plugin is darwin-only), where it is always present.
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return uid === undefined || stat.uid === uid;
}

/**
 * Refuses to proceed through a pre-existing symlink, wrong-type entry, or an
 * entry owned by a different user at the given path — for example a shared
 * XDG_CONFIG_HOME location where another user pre-planted a symlink or
 * directory to redirect Mailbridge's reads/writes. A path that does not exist
 * yet is safe; the caller is about to create it fresh. Uses lstat, which does
 * not itself follow a symlink, so the check cannot be fooled by its own read.
 */
async function assertSafeExistingPath(targetPath: string, expected: "directory" | "file"): Promise<void> {
  const stat = await lstatIfExists(targetPath);
  if (stat === undefined) return;
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to follow a symlink at the local preferences path: ${targetPath}`);
  }
  if (expected === "directory" ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`Expected a plain ${expected} at the local preferences path: ${targetPath}`);
  }
  if (!isOwnedByCurrentProcess(stat)) {
    throw new Error(`Refusing to use a local preferences path owned by another user: ${targetPath}`);
  }
}

export async function readLocalPreferences(filePath: string): Promise<ReadLocalPreferencesResult> {
  try {
    const stat = await lstatIfExists(filePath);
    if (stat === undefined) {
      return { preferences: undefined, diagnostic: undefined };
    }
    if (stat.isSymbolicLink() || !stat.isFile() || !isOwnedByCurrentProcess(stat)) {
      return { preferences: undefined, diagnostic: UNREADABLE_DIAGNOSTIC };
    }
    if (stat.size > MAX_PREFERENCES_FILE_BYTES) {
      return { preferences: undefined, diagnostic: UNREADABLE_DIAGNOSTIC };
    }

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
    return { preferences: undefined, diagnostic: UNREADABLE_DIAGNOSTIC };
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
  await assertSafeExistingPath(dir, "directory");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Re-checked immediately before chmod, which (unlike mkdir on an existing path)
  // follows a symlink on macOS — minimizes, though cannot fully eliminate, the
  // check-then-use race against something replacing dir in between.
  await assertSafeExistingPath(dir, "directory");
  await fs.chmod(dir, 0o700);

  await assertSafeExistingPath(filePath, "file");

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
