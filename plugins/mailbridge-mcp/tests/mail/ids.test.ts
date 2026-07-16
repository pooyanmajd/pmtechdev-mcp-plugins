import { describe, expect, it } from "vitest";

import type { MailBridgeError } from "../../src/mail/errors.js";
import { decodeMailId, encodeMailId, isMailId } from "../../src/mail/ids.js";

describe("opaque Mailbridge identifiers", () => {
  it("round-trips deterministic, versioned locators", () => {
    const locator = { accountKey: "account-internal", path: ["Work", "Receipts"], messageKey: "42" };
    const first = encodeMailId("message", locator);
    const second = encodeMailId("message", locator);

    expect(first).toBe(second);
    expect(first).toMatch(/^mb1\.m\.[A-Za-z0-9_-]+$/);
    expect(decodeMailId("message", first)).toEqual(locator);
    expect(isMailId("message", first)).toBe(true);
    expect(isMailId("mailbox", first)).toBe(false);
  });

  it.each([
    "",
    "mb1.m.not+base64url",
    "mb1.m.e30",
    `mb1.m.${Buffer.from(JSON.stringify({ accountKey: "a", path: [], messageKey: "1" })).toString("base64url")}`,
  ])("rejects invalid or structurally incomplete IDs: %s", (id) => {
    expect(() => decodeMailId("message", id)).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
  });

  it("does not accept a valid locator under the wrong kind prefix", () => {
    const account = encodeMailId("account", { accountKey: "a" });
    expect(() => decodeMailId("message", account)).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
  });

  it("rejects extra locator keys and encoded identifiers beyond the public schema cap", () => {
    expect(() =>
      encodeMailId("account", { accountKey: "a", extra: "smuggled" } as { accountKey: string }),
    ).toThrowError(expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }));
    expect(() => encodeMailId("account", { accountKey: "x".repeat(4_000) })).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
  });
});
