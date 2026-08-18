#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const sdefExecutable = "/usr/bin/sdef";
const mailApplication = "/System/Applications/Mail.app";
const mailSuite = { tag: "suite", attributes: { name: "Mail", code: "emal" } };
const mailFrameworkSuite = { tag: "suite", attributes: { name: "Mail Framework", code: "emsg" } };
const applicationExtension = { tag: "class-extension", attributes: { extends: "application" } };

const requiredTerms = [
  { label: "command.send/emsgsend", tag: "command", attributes: { name: "send", code: "emsgsend" }, ancestor: mailSuite },
  { label: "command.reply/emalrpms", tag: "command", attributes: { name: "reply", code: "emalrpms" }, ancestor: mailSuite },
  { label: "command.forward/emalfwms", tag: "command", attributes: { name: "forward", code: "emalfwms" }, ancestor: mailSuite },
  { label: "class.outgoing-message/bcke", tag: "class", attributes: { name: "outgoing message", code: "bcke" }, ancestor: mailSuite },
  { label: "class.account/mact", tag: "class", attributes: { name: "account", code: "mact" }, ancestor: mailFrameworkSuite },
  { label: "class.mailbox/mbxp", tag: "class", attributes: { name: "mailbox", code: "mbxp" }, ancestor: mailFrameworkSuite },
  { label: "application.accounts", tag: "element", attributes: { type: "account" }, ancestor: applicationExtension },
  { label: "application.outgoing-messages", tag: "element", attributes: { type: "outgoing message" }, ancestor: applicationExtension },
  { label: "application.mailboxes", tag: "element", attributes: { type: "mailbox" }, ancestor: applicationExtension },
  { label: "application.inbox/inmb", tag: "property", attributes: { name: "inbox", code: "inmb", type: "mailbox" }, ancestor: applicationExtension },
];

function isXmlWhitespace(character) {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isXmlNameCharacter(character) {
  if (character === undefined) return false;
  const code = character.codePointAt(0);
  return (
    character === ":" ||
    character === "_" ||
    character === "-" ||
    character === "." ||
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function skipXmlWhitespace(source, initialPosition) {
  let position = initialPosition;
  while (position < source.length && isXmlWhitespace(source[position])) position += 1;
  return position;
}

function readXmlName(source, initialPosition) {
  let position = initialPosition;
  while (position < source.length && isXmlNameCharacter(source[position])) position += 1;
  return { name: source.slice(initialPosition, position), position };
}

function attributesOf(source, initialPosition) {
  const attributes = {};
  let position = initialPosition;
  while (position < source.length) {
    position = skipXmlWhitespace(source, position);
    if (source[position] === "/" || source[position] === ">" || source[position] === undefined) break;
    const attribute = readXmlName(source, position);
    if (attribute.name.length === 0) {
      position += 1;
      continue;
    }
    position = skipXmlWhitespace(source, attribute.position);
    if (source[position] !== "=") continue;
    position = skipXmlWhitespace(source, position + 1);
    const quote = source[position];
    if (quote !== '"' && quote !== "'") continue;
    const end = source.indexOf(quote, position + 1);
    if (end === -1) break;
    attributes[attribute.name] = source.slice(position + 1, end);
    position = end + 1;
  }
  return attributes;
}

function withoutXmlComments(source) {
  const chunks = [];
  let position = 0;
  while (position < source.length) {
    const start = source.indexOf("<!--", position);
    if (start === -1) {
      chunks.push(source.slice(position));
      break;
    }
    chunks.push(source.slice(position, start));
    const end = source.indexOf("-->", start + 4);
    if (end === -1) break;
    position = end + 3;
  }
  return chunks.join("");
}

function findTagEnd(source, initialPosition) {
  let quote;
  for (let position = initialPosition; position < source.length; position += 1) {
    const character = source[position];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return position;
    }
  }
  return -1;
}

function scanDefinition(source) {
  const withoutComments = withoutXmlComments(source);
  const nodes = [];
  const stack = [];
  let cursor = 0;
  while (cursor < withoutComments.length) {
    const start = withoutComments.indexOf("<", cursor);
    if (start === -1) break;
    const end = findTagEnd(withoutComments, start + 1);
    if (end === -1) break;
    cursor = end + 1;

    let position = skipXmlWhitespace(withoutComments, start + 1);
    const closing = withoutComments[position] === "/";
    if (closing) position = skipXmlWhitespace(withoutComments, position + 1);
    if (withoutComments[position] === "!" || withoutComments[position] === "?") continue;
    const parsedTag = readXmlName(withoutComments, position);
    const tag = parsedTag.name;
    if (tag.length === 0) continue;

    if (closing) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index >= 0) stack.length = index;
      continue;
    }

    const node = { tag, attributes: attributesOf(withoutComments, parsedTag.position), ancestors: [...stack] };
    nodes.push(node);
    let finalPosition = end - 1;
    while (finalPosition > start && isXmlWhitespace(withoutComments[finalPosition])) finalPosition -= 1;
    if (withoutComments[finalPosition] !== "/") stack.push({ tag: node.tag, attributes: node.attributes });
  }
  return nodes;
}

function matches(node, expected) {
  return node.tag === expected.tag && Object.entries(expected.attributes).every(
    ([name, value]) => node.attributes[name] === value,
  );
}

export function inspectScriptingDefinition(source) {
  const nodes = scanDefinition(source);
  const terms = Object.fromEntries(requiredTerms.map((term) => {
    const present = nodes.some((node) => matches(node, term) && node.ancestors.some(
      (ancestor) => matches(ancestor, term.ancestor),
    ));
    return [term.label, present];
  }));
  const missingTerms = Object.entries(terms).filter(([, present]) => !present).map(([label]) => label);
  return { ok: missingTerms.length === 0, terms, missingTerms };
}

function readScriptingDefinition() {
  const result = spawnSync(sdefExecutable, [mailApplication], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10_000,
  });
  if (result.error !== undefined) {
    return { ok: false, reason: result.error.code === "ETIMEDOUT" ? "SDEF_TIMEOUT" : "SDEF_UNAVAILABLE" };
  }
  if (result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim().length === 0) {
    return { ok: false, reason: "SDEF_FAILED" };
  }
  return { ok: true, source: result.stdout };
}

export function checkMailCompatibility({ platform = process.platform, readDefinition = readScriptingDefinition } = {}) {
  if (platform !== "darwin") {
    return { status: "skipped", reason: "requires macOS with Mail.app installed" };
  }
  const definition = readDefinition();
  if (!definition.ok) return { status: "failed", reason: definition.reason };
  const inspection = inspectScriptingDefinition(definition.source);
  return {
    status: inspection.ok ? "compatible" : "incompatible",
    source: "Mail.app static scripting definition",
    terms: inspection.terms,
    missingTerms: inspection.missingTerms,
  };
}

function main() {
  const report = checkMailCompatibility();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "failed") {
    process.stderr.write(`Mail compatibility check could not read the static scripting definition (${report.reason}).\n`);
    process.exitCode = 1;
  } else if (report.status === "incompatible") {
    process.stderr.write("Mail.app's static scripting definition is missing one or more required Mailbridge terms.\n");
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
