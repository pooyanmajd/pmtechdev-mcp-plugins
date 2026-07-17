import { describe, expect, it } from "vitest";

import type { MailBridgeError } from "../../src/mail/errors.js";
import {
  createSearchBinding,
  decodeSearchCursor,
  encodeSearchCursor,
} from "../../src/mail/search-cursor.js";

const state = {
  scans: [{
    accountKey: "account-1",
    path: ["Inbox"],
    index: 12,
    native: false,
    done: false,
    anchorMessageKey: "message-12",
  }],
};

describe("opaque search cursors", () => {
  it("round-trips bounded progress tied to one normalized search", () => {
    const binding = createSearchBinding({ account: "account-1", subject: "Statement" });
    const cursor = encodeSearchCursor(state, binding);

    expect(cursor).toMatch(/^mb1\.s\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    expect(decodeSearchCursor(cursor, binding)).toEqual(state);
  });

  it("rejects reuse with changed filters and malformed progress", () => {
    const firstBinding = createSearchBinding({ subject: "First" });
    const secondBinding = createSearchBinding({ subject: "Second" });
    const cursor = encodeSearchCursor(state, firstBinding);

    expect(() => decodeSearchCursor(cursor, secondBinding)).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    expect(() => decodeSearchCursor(tampered, firstBinding)).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
    expect(() => encodeSearchCursor({
      scans: [{
        accountKey: "account-1",
        path: ["Inbox"],
        index: 12,
        native: false,
        done: false,
      }],
    }, firstBinding)).toThrowError(
      expect.objectContaining<Partial<MailBridgeError>>({ code: "INVALID_ID" }),
    );
  });
});
