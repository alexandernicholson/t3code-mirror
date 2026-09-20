import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  customConversationBackgroundAssetResource,
  ProjectConversationBackground,
} from "./index.ts";

const isBackground = Schema.is(ProjectConversationBackground);

describe("ProjectConversationBackground", () => {
  it("accepts built-ins and constrained custom asset references", () => {
    const custom = "custom:background-00000000-0000-4000-8000-000000000001-webp";
    expect(isBackground("landscape-redwoods")).toBe(true);
    expect(isBackground(custom)).toBe(true);
    expect(customConversationBackgroundAssetResource(custom)).toEqual({
      _tag: "attachment",
      attachmentId: "background-00000000-0000-4000-8000-000000000001-webp",
      mimeType: "image/webp",
    });
  });

  it("rejects arbitrary paths, SVG, and malformed asset references", () => {
    expect(isBackground("custom:../../secret.png")).toBe(false);
    expect(isBackground("custom:background-00000000-0000-4000-8000-000000000001-svg")).toBe(false);
    expect(isBackground("custom:background-not-a-uuid-png")).toBe(false);
  });
});
