import { describe, expect, it } from "vitest";

import { MailbridgeError, toPublicError } from "../../src/errors.js";

describe("public errors", () => {
  it("uses stable messages for known public and bridge codes", () => {
    expect(toPublicError(new MailbridgeError("TIMEOUT", "sensitive detail"))).toMatchObject({
      code: "TIMEOUT",
      message: "Apple Mail did not complete the operation before the configured timeout.",
    });
    expect(toPublicError({ code: "ATTACHMENT_TOO_LARGE", message: "private path" })).toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
      message: "The attachment exceeds the configured response limit.",
    });
    expect(toPublicError({ code: "SEND_TARGET_CHANGED", message: "private recipients" })).toMatchObject({
      code: "SEND_TARGET_CHANGED",
      message: "Apple Mail resolved reply recipients that differ from the approved recipients.",
    });
    expect(toPublicError({ code: "SEND_CONTENT_CHANGED", message: "private content" })).toMatchObject({
      code: "SEND_CONTENT_CHANGED",
      message: "Apple Mail changed the approved outgoing content before sending.",
    });
  });

  it("normalizes bridge validation codes and unknown failures", () => {
    expect(toPublicError({ code: "INVALID_ID" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(toPublicError({ code: "SOMETHING_ELSE" })).toMatchObject({ code: "MAIL_AUTOMATION_ERROR" });
    expect(toPublicError(null)).toMatchObject({ code: "MAIL_AUTOMATION_ERROR" });
  });
});
