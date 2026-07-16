import { describe, expect, it } from "vitest";

import {
  BoundedSerialQueue,
  buildMinimalChildEnvironment,
  stringifyBoundedJson
} from "../src/index.js";

describe("PMTechDev MCP kit", () => {
  it("builds a minimal environment without inheriting secrets", () => {
    const result = buildMinimalChildEnvironment({
      HOME: "/Users/example",
      LANG: "en_GB.UTF-8",
      OPENAI_API_KEY: "secret",
      GITHUB_TOKEN: "secret"
    });

    expect(result).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/example",
      LANG: "en_GB.UTF-8"
    });
  });

  it("bounds serialized requests by UTF-8 bytes", () => {
    expect(stringifyBoundedJson({ value: "ok" }, 32)).toBe('{"value":"ok"}');
    expect(() => stringifyBoundedJson({ value: "💌" }, 4, () => new Error("too large"))).toThrow(
      "too large"
    );
    expect(() => stringifyBoundedJson({ value: "too large" }, 4)).toThrow(RangeError);
    expect(() => stringifyBoundedJson({}, 0)).toThrow(RangeError);
  });

  it("serializes queued work and rejects work beyond the configured bound", async () => {
    const queue = new BoundedSerialQueue(2);
    let releaseFirst = (): void => undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = queue.run(async () => {
      order.push("first:start");
      await firstPending;
      order.push("first:end");
    }, () => new Error("busy"));
    const second = queue.run(() => {
      order.push("second");
      return Promise.resolve();
    }, () => new Error("busy"));

    await expect(queue.run(() => Promise.resolve(), () => new Error("busy"))).rejects.toThrow("busy");
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(queue.queued).toBe(0);
  });

  it("rejects invalid queue bounds", () => {
    expect(() => new BoundedSerialQueue(0)).toThrow(RangeError);
  });
});
