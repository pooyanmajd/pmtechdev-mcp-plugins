export type OutboundPreview =
  | {
      readonly kind: "message";
      readonly from: string;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly bcc: readonly string[];
      readonly subject: string;
      readonly body: string;
    }
  | {
      readonly kind: "reply";
      readonly from: string;
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly bcc: readonly string[];
      readonly sourceSubject: string;
      readonly replyAll: boolean;
      readonly body: string;
    };

export interface OutboundPreviewRow {
  readonly label: string;
  readonly value: string;
}

export interface OutboundPreviewDisplay {
  readonly eyebrow: string;
  readonly rows: readonly OutboundPreviewRow[];
  readonly bodyLines: readonly string[];
  readonly footnote: string;
}

export interface OutboundPreviewCard {
  readonly kind: OutboundPreview["kind"];
  readonly title: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject?: string;
  readonly replyToSubject?: string;
  readonly replyAll?: boolean;
  readonly body: string;
  readonly display: OutboundPreviewDisplay;
  readonly message: string;
}

const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const HEADER_IMPERSONATION = /^\s*(from|to|cc|bcc|subject|reply(?:-to| all)?|message)\s*:/i;
const LABEL_WIDTH = 8;

function encodeUnsafe(value: string): string {
  return JSON.stringify(value).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16).padStart(4, "0")}}`,
  );
}

/** Pretty-print ordinary mail; JSON-encode anything that could impersonate chrome. */
export function isDisplaySafe(value: string): boolean {
  if (UNSAFE_CHARS.test(value) || /[\r\n]/.test(value)) return false;
  return !HEADER_IMPERSONATION.test(value);
}

export function displayText(value: string): string {
  return isDisplaySafe(value) ? value : encodeUnsafe(value);
}

export function displayAddresses(addresses: readonly string[]): string {
  if (addresses.length === 0) return "—";
  if (addresses.every(isDisplaySafe)) return addresses.join(", ");
  return encodeUnsafe(addresses.join(", "));
}

function field(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)} ${value}`;
}

function previewRows(preview: OutboundPreview): OutboundPreviewRow[] {
  const rows: OutboundPreviewRow[] = [
    { label: "From", value: displayText(preview.from) },
    { label: "To", value: displayAddresses(preview.to) },
  ];
  if (preview.cc.length > 0) rows.push({ label: "Cc", value: displayAddresses(preview.cc) });
  if (preview.bcc.length > 0) rows.push({ label: "Bcc", value: displayAddresses(preview.bcc) });
  if (preview.kind === "message") {
    rows.push({ label: "Subject", value: displayText(preview.subject) });
  } else {
    rows.push({ label: "Reply to", value: displayText(preview.sourceSubject) });
    rows.push({ label: "Reply", value: preview.replyAll ? "Reply all" : "Reply" });
  }
  return rows;
}

function previewBodyLines(body: string): string[] {
  return body.split("\n").map((line) => displayText(line));
}

export function outboundPreviewDisplay(preview: OutboundPreview): OutboundPreviewDisplay {
  return {
    eyebrow: preview.kind === "message" ? "Send message" : "Send reply",
    rows: previewRows(preview),
    bodyLines: previewBodyLines(preview.body),
    footnote:
      preview.kind === "message"
        ? "No attachments. Mail will send exactly this."
        : "No attachments. Mail generates the reply subject; sender, recipients, and message are exact.",
  };
}

/** Host-agnostic Gmail-style review. Same payload Codex, Claude, and Grok must show. */
export function outboundPreviewMessage(preview: OutboundPreview): string {
  const display = outboundPreviewDisplay(preview);
  const lines = [
    display.eyebrow,
    "",
    ...display.rows.map((row) => field(row.label, row.value)),
    "",
    "┌ Message",
    ...display.bodyLines.map((line) => `│ ${line}`),
    "└",
    "",
    display.footnote,
  ];
  // Codex renders ordinary newlines in elicitation messages as collapsed whitespace.
  // U+2028 preserves the Gmail-style sections without placing untrusted content in markup.
  return lines.join("\u2028");
}

export function outboundPreviewCard(preview: OutboundPreview): OutboundPreviewCard {
  const display = outboundPreviewDisplay(preview);
  return {
    kind: preview.kind,
    title: display.eyebrow,
    from: preview.from,
    to: preview.to,
    cc: preview.cc,
    bcc: preview.bcc,
    ...(preview.kind === "message"
      ? { subject: preview.subject }
      : { replyToSubject: preview.sourceSubject, replyAll: preview.replyAll }),
    body: preview.body,
    display,
    message: outboundPreviewMessage(preview),
  };
}
