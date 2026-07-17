/*
 * Mailbridge's fixed Mail.app JXA dispatcher.
 *
 * Security boundary: all caller-controlled values arrive as bounded JSON on stdin.
 * This file never evaluates or interpolates those values as JavaScript.
 */

"use strict";

ObjC.import("Foundation");

var Mail = Application("Mail");
Mail.includeStandardAdditions = false;

var MAX_MAILBOXES = 10000;
var MAX_MESSAGES_SCANNED = 10000;
var DEFAULT_SEARCH_TIME_BUDGET_MS = 12000;
var MAX_HEADERS = 200;
var MAX_HEADER_CHARS = 4096;
var MAX_RECIPIENTS = 100;
var MAX_ATTACHMENTS = 100;
var MAX_REQUEST_BYTES = 1024 * 1024;

function bridgeError(code, message, details) {
  var error = new Error(message);
  error.mailbridgeCode = code;
  if (details) error.mailbridgeDetails = details;
  return error;
}

function fail(code, message, details) {
  throw bridgeError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isObject(value)) fail("INVALID_REQUEST", name + " must be an object.");
  return value;
}

function asString(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function property(object, name, fallback) {
  try {
    var accessor = object[name];
    // Keep the Automation object as the member-call receiver; some JXA
    // specifiers are callable proxies whose behavior depends on that receiver.
    var value = typeof accessor === "function" ? object[name]() : accessor;
    return value === null || value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function stringProperty(object, name, fallback) {
  return asString(property(object, name, fallback), fallback);
}

function boolProperty(object, name, fallback) {
  var value = property(object, name, fallback);
  return value === true;
}

function numberProperty(object, name, fallback) {
  var value = Number(property(object, name, fallback));
  return isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function listProperty(object, name) {
  var value = property(object, name, []);
  return Array.isArray(value) ? value : [];
}

function dateProperty(object, name) {
  var value = property(object, name, null);
  if (value === null) return undefined;
  try {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString();
  } catch (_) {
    return undefined;
  }
}

function normalizeEmail(value) {
  return asString(value, "").trim().toLowerCase();
}

function configuredAddresses(account) {
  var values = listProperty(account, "emailAddresses");
  var result = [];
  for (var index = 0; index < values.length; index += 1) {
    var address = normalizeEmail(values[index]);
    if (address && result.indexOf(address) < 0) result.push(address);
  }
  return result;
}

function isAllowedAccount(account, policy) {
  var allowed = policy.allowedAccounts || [];
  if (allowed.length === 0) return true;
  var configured = configuredAddresses(account);
  for (var index = 0; index < configured.length; index += 1) {
    if (allowed.indexOf(configured[index]) >= 0) return true;
  }
  return false;
}

function requireAllowedAccount(account, policy) {
  if (!isAllowedAccount(account, policy)) {
    fail("ACCOUNT_NOT_ALLOWED", "The requested Mail account is not allowed.");
  }
}

function requireUnambiguousAllowedAccounts(policy) {
  if (policy.allowedAccounts.length === 0) return;
  var candidates = accounts();
  for (var allowedIndex = 0; allowedIndex < policy.allowedAccounts.length; allowedIndex += 1) {
    var allowedAddress = policy.allowedAccounts[allowedIndex];
    var matchingAccounts = 0;
    for (var accountIndex = 0; accountIndex < candidates.length; accountIndex += 1) {
      if (configuredAddresses(candidates[accountIndex]).indexOf(allowedAddress) >= 0) {
        matchingAccounts += 1;
      }
    }
    if (matchingAccounts > 1) {
      fail("AMBIGUOUS_ID", "An allowed email address belongs to more than one Mail account.");
    }
  }
}

function accounts() {
  var result = listProperty(Mail, "accounts");
  if (result.length === 0) {
    fail("MAIL_NOT_CONFIGURED", "No accounts are configured in Mail.app.");
  }
  return result;
}

function accountKey(account) {
  var key = stringProperty(account, "id", "");
  if (!key) fail("MAIL_AUTOMATION_ERROR", "Mail.app returned an account without an identifier.");
  return key;
}

function resolveAccount(locator, policy) {
  requireObject(locator, "account identifier");
  var key = asString(locator.accountKey, "");
  if (!key) fail("INVALID_ID", "The supplied account identifier is invalid.");
  var candidates = accounts();
  var matches = [];
  for (var index = 0; index < candidates.length; index += 1) {
    if (accountKey(candidates[index]) === key) matches.push(candidates[index]);
  }
  if (matches.length === 0) fail("NOT_FOUND", "The Mail account could not be found.");
  if (matches.length > 1) fail("AMBIGUOUS_ID", "The Mail account identifier is ambiguous.");
  requireAllowedAccount(matches[0], policy);
  return matches[0];
}

function findNamedMailbox(mailboxes, name) {
  var matches = [];
  for (var index = 0; index < mailboxes.length; index += 1) {
    if (stringProperty(mailboxes[index], "name", "") === name) matches.push(mailboxes[index]);
  }
  if (matches.length === 0) fail("NOT_FOUND", "The mailbox could not be found.");
  if (matches.length > 1) fail("AMBIGUOUS_ID", "The mailbox path is ambiguous.");
  return matches[0];
}

function resolveMailbox(locator, policy) {
  requireObject(locator, "mailbox identifier");
  if (!Array.isArray(locator.path) || locator.path.length === 0 || locator.path.length > 64) {
    fail("INVALID_ID", "The supplied mailbox identifier is invalid.");
  }
  var account = resolveAccount(locator, policy);
  var current = null;
  var children = listProperty(account, "mailboxes");
  for (var index = 0; index < locator.path.length; index += 1) {
    current = findNamedMailbox(children, asString(locator.path[index], ""));
    children = listProperty(current, "mailboxes");
  }
  return { account: account, mailbox: current, path: locator.path.slice(0) };
}

function directMessageLookup(mailbox, key) {
  // Mail exposes messages through by-id specifiers, so one Apple Event can
  // resolve a message without scanning the mailbox. The candidate identity is
  // re-verified, and any failure falls back to the bounded indexed scan.
  if (!/^\d{1,18}$/.test(key)) return null;
  try {
    var collection = mailbox.messages;
    if (collection === null || collection === undefined || typeof collection.byId !== "function") {
      return null;
    }
    var candidate = collection.byId(Number(key));
    if (candidate === null || candidate === undefined) return null;
    var identity = collectionItemIdentity(candidate);
    return identity.status === "item" && identity.value === key ? candidate : null;
  } catch (_) {
    return null;
  }
}

function resolveMessage(locator, policy) {
  requireObject(locator, "message identifier");
  var resolved = resolveMailbox(locator, policy);
  var key = asString(locator.messageKey, "");
  if (!key) fail("INVALID_ID", "The supplied message identifier is invalid.");
  var direct = directMessageLookup(resolved.mailbox, key);
  if (direct) {
    return {
      account: resolved.account,
      mailbox: resolved.mailbox,
      path: resolved.path,
      message: direct,
    };
  }
  for (var index = 0; index < MAX_MESSAGES_SCANNED; index += 1) {
    var access = collectionItem(resolved.mailbox, "messages", index);
    if (access.status === "end") {
      fail("NOT_FOUND", "The message could not be found.");
    }
    if (access.status === "error") {
      fail("MAIL_AUTOMATION_ERROR", "Mail.app could not read the mailbox message collection.");
    }
    var identity = collectionItemIdentity(access.item);
    if (identity.status === "error") {
      fail("MAIL_AUTOMATION_ERROR", "Mail.app returned an unreadable message reference.");
    }
    if (identity.value === key) {
      return {
        account: resolved.account,
        mailbox: resolved.mailbox,
        path: resolved.path,
        message: access.item,
      };
    }
  }
  fail("RESPONSE_TOO_LARGE", "The mailbox is too large to resolve this message within the scan limit.");
}

function collectionItem(object, name, index) {
  try {
    var collection = object[name];
    return collectionValueItem(collection, index);
  } catch (_) {
    return { status: "error" };
  }
}

function collectionValueItem(collection, index) {
  try {
    if (collection === null || collection === undefined) return { status: "error" };
    var item = collection[index];
    if ((item === null || item === undefined) && typeof collection.at === "function") {
      item = collection.at(index);
    }
    return item === null || item === undefined
      ? { status: "end" }
      : { status: "item", item: item };
  } catch (_) {
    return { status: "error" };
  }
}

function collectionItemIdentity(item) {
  try {
    var accessor = item.id;
    var value = typeof accessor === "function" ? item.id() : accessor;
    var identity = asString(value, "");
    return identity ? { status: "item", value: identity } : { status: "error" };
  } catch (_) {
    return { status: "error" };
  }
}

function attachmentKey(attachment, index) {
  var key = stringProperty(attachment, "id", "");
  return key || "index:" + String(index);
}

function resolveAttachment(locator, policy) {
  requireObject(locator, "attachment identifier");
  var resolved = resolveMessage(locator, policy);
  var expected = asString(locator.attachmentKey, "");
  if (!expected) fail("INVALID_ID", "The supplied attachment identifier is invalid.");
  var attachments = listProperty(resolved.message, "mailAttachments");
  var matches = [];
  for (var index = 0; index < attachments.length; index += 1) {
    if (attachmentKey(attachments[index], index) === expected) {
      matches.push({ attachment: attachments[index], index: index });
    }
  }
  if (matches.length === 0) fail("NOT_FOUND", "The attachment could not be found.");
  if (matches.length > 1) fail("AMBIGUOUS_ID", "The attachment identifier is ambiguous.");
  resolved.attachment = matches[0].attachment;
  resolved.attachmentIndex = matches[0].index;
  return resolved;
}

function rawAccount(account) {
  var fullName = stringProperty(account, "fullName", "");
  return {
    accountKey: accountKey(account),
    name: stringProperty(account, "name", ""),
    emailAddresses: configuredAddresses(account),
    fullName: fullName || undefined,
    enabled: boolProperty(account, "enabled", true),
  };
}

function rawMailbox(account, mailbox, path) {
  return {
    accountKey: accountKey(account),
    path: path.slice(0),
    name: stringProperty(mailbox, "name", path[path.length - 1] || ""),
    unreadCount: numberProperty(mailbox, "unreadCount", 0),
  };
}

function flattenMailboxes(account, includeNested) {
  var output = [];
  function visit(mailboxes, parentPath, depth) {
    if (depth > 64) fail("MAIL_AUTOMATION_ERROR", "Mail.app returned a mailbox hierarchy that is too deep.");
    for (var index = 0; index < mailboxes.length; index += 1) {
      if (output.length >= MAX_MAILBOXES) {
        fail("RESPONSE_TOO_LARGE", "Mail.app returned too many mailboxes.");
      }
      var mailbox = mailboxes[index];
      var name = stringProperty(mailbox, "name", "");
      if (!name) continue;
      var path = parentPath.concat([name]);
      output.push({ account: account, mailbox: mailbox, path: path });
      if (includeNested) visit(listProperty(mailbox, "mailboxes"), path, depth + 1);
    }
  }
  visit(listProperty(account, "mailboxes"), [], 0);
  return output;
}

function inboxMailbox(account) {
  var mailboxes = listProperty(account, "mailboxes");
  for (var index = 0; index < mailboxes.length; index += 1) {
    if (stringProperty(mailboxes[index], "name", "").toLowerCase() === "inbox") {
      return { account: account, mailbox: mailboxes[index], path: [stringProperty(mailboxes[index], "name", "INBOX")] };
    }
  }
  return null;
}

function cleanMessageId(value) {
  var result = asString(value, "").trim();
  return result || undefined;
}

function rawMessage(account, mailboxPath, message, includeExtended) {
  var key = stringProperty(message, "id", "");
  if (!key) fail("MAIL_AUTOMATION_ERROR", "Mail.app returned a message without an identifier.");
  var received = dateProperty(message, "dateReceived");
  var sent = received ? undefined : dateProperty(message, "dateSent");
  var result = {
    accountKey: accountKey(account),
    path: mailboxPath.slice(0),
    messageKey: key,
    subject: stringProperty(message, "subject", ""),
    sender: stringProperty(message, "sender", ""),
    dateReceived: received,
    dateSent: sent,
    read: boolProperty(message, "readStatus", false),
    flagged: boolProperty(message, "flaggedStatus", false),
  };
  if (includeExtended) {
    result.rfcMessageId = cleanMessageId(property(message, "messageId", ""));
    if (received) result.dateSent = dateProperty(message, "dateSent");
    var size = numberProperty(message, "messageSize", -1);
    result.sizeBytes = size >= 0 ? size : undefined;
  }
  return result;
}

function rawRecipient(recipient) {
  var name = stringProperty(recipient, "name", "").trim();
  return {
    name: name || undefined,
    address: stringProperty(recipient, "address", ""),
  };
}

function recipients(message, propertyName) {
  var values = listProperty(message, propertyName);
  var output = [];
  var count = Math.min(values.length, MAX_RECIPIENTS);
  for (var index = 0; index < count; index += 1) {
    var recipient = rawRecipient(values[index]);
    if (recipient.address) output.push(recipient);
  }
  return output;
}

function rawAttachment(resolvedMessage, attachment, index) {
  return {
    accountKey: accountKey(resolvedMessage.account),
    path: resolvedMessage.path.slice(0),
    messageKey: stringProperty(resolvedMessage.message, "id", ""),
    attachmentKey: attachmentKey(attachment, index),
    filename: stringProperty(attachment, "name", "attachment"),
    mimeType: stringProperty(attachment, "mimeType", "application/octet-stream"),
    sizeBytes: numberProperty(attachment, "fileSize", 0),
    downloaded: boolProperty(attachment, "downloaded", false),
  };
}

function listAccountsOperation(request) {
  var candidates = accounts();
  var output = [];
  for (var index = 0; index < candidates.length; index += 1) {
    if (isAllowedAccount(candidates[index], request.policy)) output.push(rawAccount(candidates[index]));
  }
  return output;
}

function listMailboxesOperation(request) {
  var input = requireObject(request.input, "input");
  var selected = [];
  if (input.account) {
    selected.push(resolveAccount(input.account, request.policy));
  } else {
    var candidates = accounts();
    for (var index = 0; index < candidates.length; index += 1) {
      if (isAllowedAccount(candidates[index], request.policy)) selected.push(candidates[index]);
    }
  }
  var output = [];
  for (var accountIndex = 0; accountIndex < selected.length; accountIndex += 1) {
    var entries = flattenMailboxes(selected[accountIndex], input.includeNested !== false);
    for (var mailboxIndex = 0; mailboxIndex < entries.length; mailboxIndex += 1) {
      output.push(rawMailbox(entries[mailboxIndex].account, entries[mailboxIndex].mailbox, entries[mailboxIndex].path));
    }
  }
  return output;
}

function lower(value) {
  return asString(value, "").toLowerCase();
}

function recipientText(message) {
  var groups = ["toRecipients", "ccRecipients", "bccRecipients"];
  var values = [];
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    var group = listProperty(message, groups[groupIndex]);
    for (var index = 0; index < group.length && index < MAX_RECIPIENTS; index += 1) {
      values.push(stringProperty(group[index], "address", ""));
      values.push(stringProperty(group[index], "name", ""));
    }
  }
  return lower(values.join(" "));
}

function matchesSearch(message, input) {
  var subject;
  var sender;
  var messageId;
  var recipientCache;
  function subjectValue() {
    if (subject === undefined) subject = lower(property(message, "subject", ""));
    return subject;
  }
  function senderValue() {
    if (sender === undefined) sender = lower(property(message, "sender", ""));
    return sender;
  }
  function messageIdValue() {
    if (messageId === undefined) messageId = lower(property(message, "messageId", ""));
    return messageId;
  }
  function recipientValue() {
    if (recipientCache === undefined) recipientCache = recipientText(message);
    return recipientCache;
  }

  if (input.query) {
    var query = lower(input.query);
    // Generic search intentionally stays on metadata; full body access is reserved for getMessage.
    if (subjectValue().indexOf(query) < 0 && senderValue().indexOf(query) < 0 && messageIdValue().indexOf(query) < 0 && recipientValue().indexOf(query) < 0) {
      return false;
    }
  }
  if (input.from && senderValue().indexOf(lower(input.from)) < 0) return false;
  if (input.to && recipientValue().indexOf(lower(input.to)) < 0) return false;
  if (input.subject && subjectValue().indexOf(lower(input.subject)) < 0) return false;
  // The public tool exposes these as "only" filters; false means do not filter.
  if (input.unread === true && boolProperty(message, "readStatus", false)) return false;
  if (input.flagged === true && !boolProperty(message, "flaggedStatus", false)) return false;

  if (input.dateFrom || input.dateTo) {
    var value = property(message, "dateReceived", null) || property(message, "dateSent", null);
    var timestamp = value ? new Date(value).getTime() : NaN;
    if (isNaN(timestamp)) return false;
    if (input.dateFrom && timestamp < new Date(input.dateFrom).getTime()) return false;
    if (input.dateTo && timestamp >= new Date(input.dateTo).getTime()) return false;
  }
  return true;
}

function searchMessagesOperation(request) {
  var input = requireObject(request.input, "input");
  var limit = Math.min(Number(input.limit) || 25, request.policy.maxResults, 100);
  var configuredSearchTimeBudget = Number(request.policy.searchTimeBudgetMs);
  var searchTimeBudgetMs = isFinite(configuredSearchTimeBudget) && configuredSearchTimeBudget >= 1
    ? Math.floor(configuredSearchTimeBudget)
    : DEFAULT_SEARCH_TIME_BUDGET_MS;
  var startedAt = Date.now();
  var selectedMailboxes = [];
  var selectionIncomplete = false;
  if (input.mailbox) {
    var resolved = resolveMailbox(input.mailbox, request.policy);
    selectedMailboxes.push(resolved);
  } else {
    var selectedAccounts = [];
    if (input.account) {
      selectedAccounts.push(resolveAccount(input.account, request.policy));
    } else {
      var accountCandidates = accounts();
      for (var accountIndex = 0; accountIndex < accountCandidates.length; accountIndex += 1) {
        if (isAllowedAccount(accountCandidates[accountIndex], request.policy)) selectedAccounts.push(accountCandidates[accountIndex]);
      }
    }
    for (var selectedIndex = 0; selectedIndex < selectedAccounts.length; selectedIndex += 1) {
      if (input.scope === "inbox") {
        var inbox = inboxMailbox(selectedAccounts[selectedIndex]);
        if (inbox) selectedMailboxes.push(inbox);
        else selectionIncomplete = true;
      } else {
        var flattened = flattenMailboxes(selectedAccounts[selectedIndex], true);
        for (var mailboxIndex = 0; mailboxIndex < flattened.length; mailboxIndex += 1) {
          selectedMailboxes.push(flattened[mailboxIndex]);
        }
      }
    }
  }

  var matches = [];
  var seenMessages = Object.create(null);
  var scanned = 0;
  var skipped = selectionIncomplete;
  var budgetExhausted = false;
  function timestamp(summary) {
    return Date.parse(summary.dateReceived || summary.dateSent || "") || 0;
  }
  function searchBudgetAvailable() {
    return scanned < MAX_MESSAGES_SCANNED && Date.now() - startedAt < searchTimeBudgetMs;
  }
  var mailboxScans = [];
  for (var selectedMailboxIndex = 0; selectedMailboxIndex < selectedMailboxes.length; selectedMailboxIndex += 1) {
    var selectedMailbox = selectedMailboxes[selectedMailboxIndex];
    var messages;
    try {
      messages = selectedMailbox.mailbox.messages;
    } catch (_) {
      messages = null;
    }
    mailboxScans.push({
      selectedMailbox: selectedMailbox,
      messages: messages,
      index: 0,
      done: false,
      candidate: null,
    });
  }

  function advanceOne(scan) {
    if (scan.done || scan.candidate) return;
    if (!searchBudgetAvailable()) {
      budgetExhausted = true;
      return;
    }
    var access = collectionValueItem(scan.messages, scan.index);
    scan.index += 1;
    if (access.status === "end") {
      scan.done = true;
      return;
    }
    if (access.status === "error") {
      scan.done = true;
      skipped = true;
      return;
    }
    scanned += 1;
    try {
      if (!matchesSearch(access.item, input)) return;
      var summary = rawMessage(scan.selectedMailbox.account, scan.selectedMailbox.path, access.item, false);
      var identity = summary.accountKey + "\u0000" + summary.messageKey;
      if (seenMessages[identity]) return;
      seenMessages[identity] = true;
      scan.candidate = summary;
    } catch (_) {
      // A corrupt/unavailable individual message must not fail an otherwise useful search.
      skipped = true;
    }
  }

  function fillCandidates() {
    var pending = true;
    while (pending && !budgetExhausted) {
      pending = false;
      for (var scanIndex = 0; scanIndex < mailboxScans.length; scanIndex += 1) {
        var scan = mailboxScans[scanIndex];
        if (scan.done || scan.candidate) continue;
        pending = true;
        advanceOne(scan);
        if (budgetExhausted) return;
      }
    }
  }

  // Mail exposes each mailbox newest-first. Merge those ordered streams instead
  // of rescanning every selected mailbox before returning a small latest page.
  fillCandidates();
  while (matches.length < limit && !budgetExhausted) {
    var newestScan = null;
    for (var candidateIndex = 0; candidateIndex < mailboxScans.length; candidateIndex += 1) {
      var candidateScan = mailboxScans[candidateIndex];
      if (!candidateScan.candidate) continue;
      if (!newestScan || timestamp(candidateScan.candidate) > timestamp(newestScan.candidate)) {
        newestScan = candidateScan;
      }
    }
    if (!newestScan) break;
    matches.push(newestScan.candidate);
    newestScan.candidate = null;
    if (matches.length >= limit) break;
    while (!newestScan.done && !newestScan.candidate && !budgetExhausted) advanceOne(newestScan);
  }

  return {
    messages: matches,
    scannedCount: scanned,
    incomplete: skipped || budgetExhausted,
  };
}

function fullMessage(resolved, maximum) {
  var summary = rawMessage(resolved.account, resolved.path, resolved.message, true);
  var body = stringProperty(resolved.message, "content", "");
  var originalBodyChars = body.length;
  summary.body = body.slice(0, maximum);
  summary.bodyTruncated = originalBodyChars > maximum;
  summary.originalBodyChars = originalBodyChars;
  var replyTo = stringProperty(resolved.message, "replyTo", "").trim();
  summary.replyTo = replyTo || undefined;

  summary.headers = [];
  var headers = listProperty(resolved.message, "headers");
  for (var headerIndex = 0; headerIndex < headers.length && headerIndex < MAX_HEADERS; headerIndex += 1) {
    var headerName = stringProperty(headers[headerIndex], "name", "").slice(0, 256);
    if (!headerName) continue;
    summary.headers.push({
      name: headerName,
      value: stringProperty(headers[headerIndex], "content", "").slice(0, MAX_HEADER_CHARS),
    });
  }
  summary.recipients = {
    to: recipients(resolved.message, "toRecipients"),
    cc: recipients(resolved.message, "ccRecipients"),
    bcc: recipients(resolved.message, "bccRecipients"),
  };
  summary.attachments = [];
  var attachments = listProperty(resolved.message, "mailAttachments");
  for (var attachmentIndex = 0; attachmentIndex < attachments.length && attachmentIndex < MAX_ATTACHMENTS; attachmentIndex += 1) {
    summary.attachments.push(rawAttachment(resolved, attachments[attachmentIndex], attachmentIndex));
  }
  return summary;
}

function getMessageOperation(request) {
  var input = requireObject(request.input, "input");
  var resolved = resolveMessage(input.message, request.policy);
  var maximum = Math.min(Number(input.maxBodyChars) || request.policy.maxBodyChars, request.policy.maxBodyChars);
  return fullMessage(resolved, maximum);
}

function getMessagesOperation(request) {
  var input = requireObject(request.input, "input");
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > request.policy.maxResults) {
    fail("INVALID_REQUEST", "The message identifier batch is invalid.");
  }
  var maximum = Math.min(Number(input.maxBodyChars) || request.policy.maxBodyChars, request.policy.maxBodyChars);
  var output = [];
  for (var index = 0; index < input.messages.length; index += 1) {
    output.push(fullMessage(resolveMessage(input.messages[index], request.policy), maximum));
  }
  return output;
}

function getAttachmentOperation(request) {
  var input = requireObject(request.input, "input");
  var resolved = resolveAttachment(input.attachment, request.policy);
  var metadata = rawAttachment(resolved, resolved.attachment, resolved.attachmentIndex);
  var maximum = Math.min(Number(input.maxBytes) || request.policy.maxAttachmentBytes, request.policy.maxAttachmentBytes);
  if (!metadata.downloaded) {
    fail(
      "UNSUPPORTED_ATTACHMENT",
      "The attachment is not downloaded in Mail.app; Mailbridge will not trigger a network download.",
    );
  }
  if (metadata.sizeBytes > maximum) {
    fail("ATTACHMENT_TOO_LARGE", "The attachment exceeds the configured byte limit.", {
      sizeBytes: metadata.sizeBytes,
      maxBytes: maximum,
    });
  }

  var manager = $.NSFileManager.defaultManager;
  var temporaryDirectory = ObjC.unwrap($.NSTemporaryDirectory());
  var attachmentDirectory = asString(request.policy.attachmentDirectory, "");
  var expectedPrefix = temporaryDirectory + "mailbridge-";
  var directorySuffix = attachmentDirectory.slice(expectedPrefix.length);
  if (attachmentDirectory.indexOf(expectedPrefix) !== 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(directorySuffix)) {
    fail("INVALID_REQUEST", "The private attachment directory is invalid.");
  }
  var path = attachmentDirectory + "/attachment";
  try {
    Mail.save(resolved.attachment, { in: Path(path) });
    var attributes = manager.attributesOfItemAtPathError($(path), null);
    if (!attributes) {
      fail("UNSUPPORTED_ATTACHMENT", "Mail.app could not expose this attachment through public automation.");
    }
    var sizeValue = attributes.objectForKey($.NSFileSize);
    var actualSize = sizeValue ? Number(sizeValue.unsignedLongLongValue) : NaN;
    if (!isFinite(actualSize) || actualSize < 0) {
      fail("UNSUPPORTED_ATTACHMENT", "Mail.app returned unreadable attachment content.");
    }
    if (actualSize > maximum) {
      fail("ATTACHMENT_TOO_LARGE", "The attachment exceeds the configured byte limit.", {
        sizeBytes: actualSize,
        maxBytes: maximum,
      });
    }
    var data = manager.contentsAtPath($(path));
    if (!data || Number(data.length) !== actualSize) {
      fail("UNSUPPORTED_ATTACHMENT", "Mail.app returned unreadable attachment content.");
    }
    metadata.encoding = "base64";
    metadata.content = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
    metadata.truncated = false;
    metadata.sizeBytes = actualSize;
    return metadata;
  } catch (error) {
    if (error && error.mailbridgeCode) throw error;
    fail("UNSUPPORTED_ATTACHMENT", "Mail.app could not expose this attachment through public automation.");
  } finally {
    try {
      manager.removeItemAtPathError($(path), null);
    } catch (_) {
      // Best-effort cleanup of the UUID-named temporary file.
    }
  }
}

function setMessageStateOperation(request) {
  var input = requireObject(request.input, "input");
  var resolved = resolveMessage(input.message, request.policy);
  var previousRead = boolProperty(resolved.message, "readStatus", false);
  var previousFlagged = boolProperty(resolved.message, "flaggedStatus", false);
  try {
    if (typeof input.read === "boolean") resolved.message.readStatus = input.read;
    if (typeof input.flagged === "boolean") resolved.message.flaggedStatus = input.flagged;
    return rawMessage(resolved.account, resolved.path, resolved.message, true);
  } catch (error) {
    try {
      resolved.message.readStatus = previousRead;
      resolved.message.flaggedStatus = previousFlagged;
    } catch (_) {
      // Best-effort rollback; the server reports an outcome-unknown mutation error on timeout.
    }
    throw error;
  }
}

function ensureSender(account, sender, policy) {
  requireAllowedAccount(account, policy);
  var normalized = normalizeEmail(sender);
  if (!normalized || configuredAddresses(account).indexOf(normalized) < 0) {
    fail("INVALID_REQUEST", "The sender is not configured for the selected Mail account.");
  }
  if (policy.allowedAccounts.length > 0 && policy.allowedAccounts.indexOf(normalized) < 0) {
    fail("ACCOUNT_NOT_ALLOWED", "The sender account is not allowed.");
  }
  return normalized;
}

function addRecipients(draft, propertyName, constructor, addresses) {
  for (var index = 0; index < addresses.length; index += 1) {
    draft[propertyName].push(constructor(addresses[index]));
  }
}

function addAddressing(draft, input) {
  addRecipients(draft, "toRecipients", function (address) {
    return Mail.ToRecipient({ address: address });
  }, input.to || []);
  addRecipients(draft, "ccRecipients", function (address) {
    return Mail.CcRecipient({ address: address });
  }, input.cc || []);
  addRecipients(draft, "bccRecipients", function (address) {
    return Mail.BccRecipient({ address: address });
  }, input.bcc || []);
}

function rawDraft(account, draft, sender, sent) {
  var key = stringProperty(draft, "id", "");
  if (!key) fail("MAIL_AUTOMATION_ERROR", "Mail.app returned a draft without an identifier.");
  return {
    accountKey: accountKey(account),
    draftKey: key,
    sender: sender,
    subject: stringProperty(draft, "subject", ""),
    sent: sent === true,
  };
}

function persistDraft(draft) {
  try {
    Mail.save(draft);
  } catch (_) {
    fail("MAIL_AUTOMATION_ERROR", "Mail.app could not save the unsent draft.");
  }
}

function discardDraft(draft) {
  try {
    Mail.delete(draft);
  } catch (_) {
    // Best-effort rollback; the server reports an outcome-unknown mutation error on timeout.
  }
}

function createDraftOperation(request) {
  var input = requireObject(request.input, "input");
  var account = resolveAccount(input.account, request.policy);
  var sender = ensureSender(account, input.from, request.policy);
  var draft = Mail.OutgoingMessage({
    visible: false,
    sender: sender,
    subject: asString(input.subject, ""),
    content: asString(input.body, ""),
  });
  var registered = false;
  try {
    addAddressing(draft, input);
    Mail.outgoingMessages.push(draft);
    registered = true;
    persistDraft(draft);
    return rawDraft(account, draft, sender, false);
  } catch (error) {
    if (registered) discardDraft(draft);
    throw error;
  }
}

function prependBody(draft, body) {
  if (body === undefined) return;
  var prefix = asString(body, "");
  var existing = stringProperty(draft, "content", "");
  draft.content = prefix + (prefix && existing ? "\n\n" : "") + existing;
}

function createReplyDraftOperation(request) {
  var input = requireObject(request.input, "input");
  var resolved = resolveMessage(input.message, request.policy);
  var sender = ensureSender(resolved.account, input.from, request.policy);
  var draft = Mail.reply(resolved.message, {
    openingWindow: false,
    replyToAll: input.replyAll === true,
  });
  try {
    draft.visible = false;
    draft.sender = sender;
    prependBody(draft, input.body);
    persistDraft(draft);
    return rawDraft(resolved.account, draft, sender, false);
  } catch (error) {
    discardDraft(draft);
    throw error;
  }
}

function createForwardDraftOperation(request) {
  var input = requireObject(request.input, "input");
  var resolved = resolveMessage(input.message, request.policy);
  var sender = ensureSender(resolved.account, input.from, request.policy);
  var draft = Mail.forward(resolved.message, { openingWindow: false });
  try {
    draft.visible = false;
    draft.sender = sender;
    addAddressing(draft, input);
    prependBody(draft, input.body);
    persistDraft(draft);
    return rawDraft(resolved.account, draft, sender, false);
  } catch (error) {
    discardDraft(draft);
    throw error;
  }
}

var OPERATIONS = {
  listAccounts: listAccountsOperation,
  listMailboxes: listMailboxesOperation,
  searchMessages: searchMessagesOperation,
  getMessage: getMessageOperation,
  getMessages: getMessagesOperation,
  getAttachment: getAttachmentOperation,
  setMessageState: setMessageStateOperation,
  createDraft: createDraftOperation,
  createReplyDraft: createReplyDraftOperation,
  createForwardDraft: createForwardDraftOperation,
};

function validateRequest(request) {
  requireObject(request, "request");
  if (typeof request.operation !== "string" || !Object.prototype.hasOwnProperty.call(OPERATIONS, request.operation)) {
    fail("INVALID_REQUEST", "The Mail automation operation is not supported.");
  }
  requireObject(request.input, "input");
  requireObject(request.policy, "policy");
  if (!Array.isArray(request.policy.allowedAccounts)) fail("INVALID_REQUEST", "allowedAccounts is invalid.");
  for (var index = 0; index < request.policy.allowedAccounts.length; index += 1) {
    request.policy.allowedAccounts[index] = normalizeEmail(request.policy.allowedAccounts[index]);
  }
  requireUnambiguousAllowedAccounts(request.policy);
  request.policy.maxBodyChars = Math.max(1, Math.min(Number(request.policy.maxBodyChars) || 1, 1000000));
  request.policy.maxAttachmentBytes = Math.max(1, Math.min(Number(request.policy.maxAttachmentBytes) || 1, 5 * 1024 * 1024));
  request.policy.maxResults = Math.max(1, Math.min(Number(request.policy.maxResults) || 1, 100));
  if (request.operation === "getAttachment" && typeof request.policy.attachmentDirectory !== "string") {
    fail("INVALID_REQUEST", "The private attachment directory is required.");
  }
  return request;
}

function serializedFailure(error) {
  var code = error && error.mailbridgeCode ? asString(error.mailbridgeCode, "MAIL_AUTOMATION_ERROR") : "MAIL_AUTOMATION_ERROR";
  var message = error && error.message ? asString(error.message, "Mail.app automation failed.") : "Mail.app automation failed.";
  var number = error && error.errorNumber !== undefined ? Number(error.errorNumber) : undefined;
  if (number === -1743 || /not authorized|not permitted to send apple events/i.test(message)) {
    code = "AUTOMATION_DENIED";
    message = "macOS denied permission to automate Mail.app.";
  } else if (!error || !error.mailbridgeCode) {
    message = "Mail.app automation failed.";
  }
  return {
    ok: false,
    error: {
      code: code,
      message: message,
      details: error && error.mailbridgeDetails ? error.mailbridgeDetails : undefined,
    },
  };
}

function readRequestFromStdin() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var length = Number(data.length);
  if (!isFinite(length) || length <= 0 || length > MAX_REQUEST_BYTES) {
    fail("INVALID_REQUEST", "The Mail automation request has an invalid size.");
  }
  var value = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  if (!value) fail("INVALID_REQUEST", "The Mail automation request is not valid UTF-8.");
  return ObjC.unwrap(value);
}

function run(argv) {
  try {
    if (!Array.isArray(argv) || argv.length !== 0) {
      fail("INVALID_REQUEST", "Mailbridge does not accept request data in process arguments.");
    }
    var request;
    try {
      request = JSON.parse(readRequestFromStdin());
    } catch (_) {
      fail("INVALID_REQUEST", "The Mail automation request is not valid JSON.");
    }
    request = validateRequest(request);
    return JSON.stringify({ ok: true, result: OPERATIONS[request.operation](request) });
  } catch (error) {
    return JSON.stringify(serializedFailure(error));
  }
}
