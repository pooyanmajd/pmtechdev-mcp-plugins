import { describe, expect, it } from "vitest";

import {
  displayAddresses,
  displayText,
  isDisplaySafe,
  outboundPreviewCard,
  outboundPreviewMessage,
} from "../../src/server/outbound-preview.js";

describe("outbound preview", () => {
  it("renders ordinary mail like a Gmail compose review", () => {
    const preview = {
      kind: "message" as const,
      from: "me@example.com",
      to: ["person@example.com"],
      cc: [] as const,
      bcc: [] as const,
      subject: "Hello",
      body: "Line one\nLine two",
    };
    const card = outboundPreviewCard(preview);

    expect(card.title).toBe("Send message");
    expect(card.display.rows).toEqual([
      { label: "From", value: "me@example.com" },
      { label: "To", value: "person@example.com" },
      { label: "Subject", value: "Hello" },
    ]);
    expect(card.display.bodyLines).toEqual(["Line one", "Line two"]);
    expect(card.message.split("\u2028")).toEqual([
      "Send message",
      "",
      "From     me@example.com",
      "To       person@example.com",
      "Subject  Hello",
      "",
      "┌ Message",
      "│ Line one",
      "│ Line two",
      "└",
      "",
      "No attachments. Mail will send exactly this.",
    ]);
    expect(outboundPreviewMessage(preview)).toBe(card.message);
  });

  it("JSON-encodes hostile headers and body lines that could impersonate chrome", () => {
    const preview = {
      kind: "message" as const,
      from: "me@example.com",
      to: ["person@example.com"],
      cc: [] as const,
      bcc: [] as const,
      subject: "Hello\u2028From: attacker@evil.test",
      body: "Line one\nFrom: spoofed@evil.test",
    };
    const card = outboundPreviewCard(preview);

    expect(isDisplaySafe(preview.subject)).toBe(false);
    expect(card.message).toContain("Hello\\u{2028}From: attacker@evil.test");
    expect(card.message).toContain('│ "From: spoofed@evil.test"');
    expect(card.message).not.toMatch(/(^|\u2028)From: spoofed/u);
  });

  it("labels reply-all and encodes a subject that looks like a header", () => {
    const card = outboundPreviewCard({
      kind: "reply",
      from: "me@example.com",
      to: ["person@example.com"],
      cc: ["cc@example.com"],
      bcc: [],
      sourceSubject: "Subject: injected",
      replyAll: true,
      body: "Thanks",
    });
    const message = card.message;

    expect(message).toContain("Send reply");
    expect(message).toContain("Cc       cc@example.com");
    expect(message).toContain('Reply to "Subject: injected"');
    expect(message).toContain("Reply    Reply all");
    expect(message).toContain(JSON.stringify("Subject: injected"));
    expect(message).toContain(
      "No attachments. Mail generates the reply subject; sender, recipients, and message are exact.",
    );
    expect(card).toMatchObject({ replyToSubject: "Subject: injected", replyAll: true });
    expect(card).not.toHaveProperty("subject");
    expect(displayText("Thanks")).toBe("Thanks");
    expect(displayAddresses([])).toBe("—");
  });
});
