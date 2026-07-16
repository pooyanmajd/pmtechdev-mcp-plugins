import { describe, expect, it } from "vitest";

import { PLUGIN_INFO } from "../src/info.js";

describe("plugin metadata", () => {
  it("keeps the generated name and display name", () => {
    expect(PLUGIN_INFO).toEqual({
      name: "__PLUGIN_NAME__",
      displayName: "__PLUGIN_DISPLAY_NAME__",
      version: "0.1.0"
    });
  });
});
