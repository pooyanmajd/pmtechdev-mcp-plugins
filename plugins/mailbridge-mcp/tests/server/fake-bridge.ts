import { vi } from "vitest";

import type { MailBridge } from "../../src/mail/bridge.js";

export function createFakeBridge(): {
  readonly bridge: MailBridge;
  readonly spies: Record<keyof MailBridge, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    listAccounts: vi.fn().mockResolvedValue([]),
    listMailboxes: vi.fn().mockResolvedValue([]),
    searchMessages: vi.fn().mockResolvedValue({ messages: [], scannedCount: 0, incomplete: false }),
    getMessage: vi.fn().mockResolvedValue({}),
    getMessages: vi.fn().mockResolvedValue([]),
    getAttachment: vi.fn().mockResolvedValue({}),
    setMessageState: vi.fn().mockResolvedValue({}),
    createDraft: vi.fn().mockResolvedValue({}),
    createReplyDraft: vi.fn().mockResolvedValue({}),
    createForwardDraft: vi.fn().mockResolvedValue({}),
  } satisfies Record<keyof MailBridge, ReturnType<typeof vi.fn>>;

  return {
    bridge: spies,
    spies,
  };
}
