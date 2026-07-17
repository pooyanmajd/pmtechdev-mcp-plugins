import { describe, expect, it } from "vitest";

import { CONFIG_DEFAULTS, CONFIG_LIMITS, ConfigError, loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("uses conservative defaults", () => {
    expect(loadConfig({})).toEqual({
      mode: "read-only",
      allowedAccounts: undefined,
      maxResults: CONFIG_DEFAULTS.maxResults,
      maxBodyChars: CONFIG_DEFAULTS.maxBodyChars,
      timeoutMs: CONFIG_DEFAULTS.timeoutMs,
      searchBudgetMs: CONFIG_DEFAULTS.searchBudgetMs,
    });
  });

  it("parses explicit settings and normalizes allowed accounts", () => {
    expect(
      loadConfig({
        MAILBRIDGE_MODE: "full",
        MAILBRIDGE_ALLOWED_ACCOUNTS: " First@Example.com,second@example.com,first@example.com ",
        MAILBRIDGE_MAX_RESULTS: "75",
        MAILBRIDGE_MAX_BODY_CHARS: "50000",
        MAILBRIDGE_TIMEOUT_MS: "10000",
        MAILBRIDGE_SEARCH_BUDGET_MS: "7000",
      }),
    ).toEqual({
      mode: "full",
      allowedAccounts: ["first@example.com", "second@example.com"],
      maxResults: 75,
      maxBodyChars: 50_000,
      timeoutMs: 10_000,
      searchBudgetMs: 7_000,
    });
  });

  it("requires an explicit account allowlist in send mode", () => {
    expect(() => loadConfig({ MAILBRIDGE_MODE: "send" })).toThrow(ConfigError);
    expect(() => loadConfig({ MAILBRIDGE_MODE: "send" })).toThrow(
      "MAILBRIDGE_ALLOWED_ACCOUNTS",
    );
    expect(
      loadConfig({
        MAILBRIDGE_MODE: "send",
        MAILBRIDGE_ALLOWED_ACCOUNTS: "sender@example.com",
      }).mode,
    ).toBe("send");
  });

  it.each([
    [{ MAILBRIDGE_MODE: "write" }, "MAILBRIDGE_MODE"],
    [{ MAILBRIDGE_MAX_RESULTS: "0" }, "MAILBRIDGE_MAX_RESULTS"],
    [{ MAILBRIDGE_MAX_RESULTS: "1.5" }, "MAILBRIDGE_MAX_RESULTS"],
    [{ MAILBRIDGE_MAX_RESULTS: String(CONFIG_LIMITS.maxResults + 1) }, "MAILBRIDGE_MAX_RESULTS"],
    [{ MAILBRIDGE_MAX_BODY_CHARS: "-1" }, "MAILBRIDGE_MAX_BODY_CHARS"],
    [{ MAILBRIDGE_TIMEOUT_MS: "NaN" }, "MAILBRIDGE_TIMEOUT_MS"],
    [{ MAILBRIDGE_SEARCH_BUDGET_MS: "0" }, "MAILBRIDGE_SEARCH_BUDGET_MS"],
    [{ MAILBRIDGE_TIMEOUT_MS: "10000", MAILBRIDGE_SEARCH_BUDGET_MS: "9000" }, "MAILBRIDGE_SEARCH_BUDGET_MS"],
    [{ MAILBRIDGE_ALLOWED_ACCOUNTS: "not-an-address" }, "MAILBRIDGE_ALLOWED_ACCOUNTS"],
  ])("rejects invalid configuration without echoing its value: %j", (env, variable) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(variable);
  });

  it("treats empty optional settings as unset", () => {
    expect(
      loadConfig({
        MAILBRIDGE_MODE: " ",
        MAILBRIDGE_ALLOWED_ACCOUNTS: " ",
      }),
    ).toEqual(loadConfig({}));
  });

  it("derives a safe default search budget from short subprocess timeouts", () => {
    expect(loadConfig({ MAILBRIDGE_TIMEOUT_MS: "1000" }).searchBudgetMs).toBe(800);
  });
});
