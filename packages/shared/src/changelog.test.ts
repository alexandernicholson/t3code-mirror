import { describe, expect, it } from "vite-plus/test";
import { changelogBetween, parseChangelog } from "./changelog.ts";

const notes =
  "# Changelog\n\n## [0.2.0] - 2026-09-08\n\n- New feature\n\n---\n\n## [0.1.1] - 2026-09-07\n\n- Fix\n\n---\n\n## [0.1.0] - 2026-09-06\n\n- First release\n";
describe("changelog release intervals", () => {
  it("includes every skipped release and excludes the already installed release", () => {
    const result = changelogBetween(notes, "0.1.0", "0.2.0");
    expect(result).toContain("New feature");
    expect(result).toContain("Fix");
    expect(result).not.toContain("First release");
  });
  it("shows target history when branches do not have a comparable interval", () => {
    expect(changelogBetween(notes, null, "0.1.1")).toContain("First release");
    expect(changelogBetween(notes, null, "0.1.1")).not.toContain("New feature");
  });
  it("rejects duplicated and out-of-order versions", () => {
    expect(() => parseChangelog(notes + "\n## [0.1.1] - 2026-09-08\n\n- Duplicate\n")).toThrow(
      "duplicate",
    );
    expect(() => parseChangelog(notes.replace("[0.2.0]", "[0.0.1]"))).toThrow("newest first");
  });
});
