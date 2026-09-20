import { describe, expect, it } from "vite-plus/test";

import { validateBackgroundUpload } from "./BackgroundUploadValidation.ts";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

describe("validateBackgroundUpload", () => {
  it("accepts supported static and animated image headers", () => {
    expect(validateBackgroundUpload(png(3840, 2160), "image/png")).toBeNull();
    expect(validateBackgroundUpload(gif(1920, 1080), "image/gif")).toBeNull();
  });

  it("rejects MIME spoofing and non-image payloads", () => {
    expect(validateBackgroundUpload(png(100, 100), "image/gif")).toMatch(/do not match/);
    expect(
      validateBackgroundUpload(new TextEncoder().encode("<svg onload=alert(1)>"), "image/png"),
    ).toMatch(/do not match/);
  });

  it("rejects decompression bombs before a browser decodes them", () => {
    expect(validateBackgroundUpload(png(8192, 8192), "image/png")).toMatch(/too many pixels/);
    expect(validateBackgroundUpload(gif(65_535, 1), "image/gif")).toMatch(/too many pixels/);
  });
});
