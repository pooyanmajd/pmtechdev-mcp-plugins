import { describe, expect, it } from "vitest";

// The compatibility checker is shipped as an executable JavaScript file so it
// can run directly from the published package. Keep its test-facing contract
// explicit here without adding a declaration file to the runtime payload.
// @ts-expect-error The executable intentionally has no standalone declaration file.
import * as compatibilityModule from "../../scripts/check-mail-compat.mjs";

type DefinitionReadResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly reason: string };

const { checkMailCompatibility, inspectScriptingDefinition } = compatibilityModule as unknown as {
  readonly inspectScriptingDefinition: (source: string) => {
    readonly ok: boolean;
    readonly missingTerms: readonly string[];
  };
  readonly checkMailCompatibility: (options?: {
    readonly platform?: NodeJS.Platform;
    readonly readDefinition?: () => DefinitionReadResult;
  }) => unknown;
};

const compatibleDefinition = `
<dictionary>
  <suite name="Mail" code="emal">
    <command name="send" code="emsgsend"/>
    <command name="reply" code="emalrpms"/>
    <command name="forward" code="emalfwms"/>
    <class name="outgoing message" code="bcke"/>
    <class-extension extends="application">
      <element type="account"/>
      <element type="outgoing message"/>
      <element type="mailbox"/>
      <property name="inbox" code="inmb" type="mailbox"/>
    </class-extension>
  </suite>
  <suite name="Mail Framework" code="emsg">
    <class name="account" code="mact"/>
    <class name="mailbox" code="mbxp"/>
  </suite>
</dictionary>
`;

describe("Mail.app static scripting-definition compatibility", () => {
  it("accepts the canonical Mail terms and event codes", () => {
    expect(inspectScriptingDefinition(compatibleDefinition)).toMatchObject({ ok: true, missingTerms: [] });
  });

  it("does not accept a matching term from the wrong suite", () => {
    const wrongSuite = compatibleDefinition.replace(
      '<command name="send" code="emsgsend"/>',
      '</suite><suite name="Other" code="othr"><command name="send" code="emsgsend"/></suite><suite name="Mail" code="emal">',
    );
    expect(inspectScriptingDefinition(wrongSuite)).toMatchObject({
      ok: false,
      missingTerms: ["command.send/emsgsend"],
    });
  });

  it("ignores terms inside XML comments, including an unterminated comment tail", () => {
    const commentedTerms = compatibleDefinition
      .replace('<command name="send" code="emsgsend"/>', '<!-- <command name="send" code="emsgsend"/> -->')
      .concat('<!-- <command name="send" code="emsgsend"/>');

    expect(inspectScriptingDefinition(commentedTerms)).toMatchObject({
      ok: false,
      missingTerms: ["command.send/emsgsend"],
    });
  });

  it("skips before reading any definition on non-macOS hosts", () => {
    let read = false;
    const result = checkMailCompatibility({
      platform: "linux",
      readDefinition: () => {
        read = true;
        return { ok: false, reason: "SHOULD_NOT_RUN" };
      },
    });
    expect(read).toBe(false);
    expect(result).toEqual({ status: "skipped", reason: "requires macOS with Mail.app installed" });
  });

  it("returns only a stable reason when sdef cannot be read", () => {
    expect(checkMailCompatibility({
      platform: "darwin",
      readDefinition: () => ({ ok: false, reason: "SDEF_FAILED" }),
    })).toEqual({ status: "failed", reason: "SDEF_FAILED" });
  });
});
