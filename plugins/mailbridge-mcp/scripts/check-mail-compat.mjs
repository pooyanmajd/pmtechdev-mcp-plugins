#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const requiredSelectors = [
  "outgoingMessages",
  "send",
  "reply",
  "forward",
  "accounts",
  "mailboxes",
  "inbox",
];

function skip(reason) {
  process.stdout.write(`Mail compatibility check skipped: ${reason}\n`);
  process.exit(0);
}

if (process.platform !== "darwin") {
  skip("requires macOS and Mail.app (this is expected on Linux CI).");
}

const probe = `
ObjC.import("stdlib");
function textOf(value) {
  try { return String(value); } catch (_) { return ""; }
}
var result = { ok: false };
try {
  var Mail = Application("Mail");
  result.name = textOf(Mail.name());
  result.version = textOf(Mail.version());
  result.running = Mail.running();
  var source = textOf(Mail.toString());
  result.selectors = {};
  var required = ${JSON.stringify(requiredSelectors)};
  var missing = [];
  for (var i = 0; i < required.length; i += 1) {
    var name = required[i];
    var present = source.indexOf(name) >= 0;
    result.selectors[name] = present;
    if (!present) missing.push(name);
  }
  result.missing = missing;
  result.ok = missing.length === 0;
} catch (error) {
  result.error = textOf(error);
}
JSON.stringify(result);
`;

const compiled = spawnSync("/usr/bin/osascript", ["-l", "JavaScript"], {
  input: probe,
  encoding: "utf8",
});

if (compiled.status !== 0) {
  process.stderr.write(
    `Mail compatibility check failed to run osascript:\n${compiled.stderr || compiled.stdout}\n`,
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(compiled.stdout.trim());
} catch {
  process.stderr.write("Mail compatibility check returned invalid JSON.\n");
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.stderr.write(
    "Mail.app is missing one or more scripting selectors Mailbridge depends on. See plugins/mailbridge-mcp/docs/COMPATIBILITY.md.\n",
  );
  process.exit(1);
}
