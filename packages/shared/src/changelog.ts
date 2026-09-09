import { compareSemverVersions } from "./semver.ts";

export const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ChangelogRelease {
  readonly version: string;
  readonly date: string;
  readonly markdown: string;
}

/** Version headings delimit releases; horizontal rules remain ordinary Markdown within notes. */
export function parseChangelog(markdown: string): ReadonlyArray<ChangelogRelease> {
  const headings = [...markdown.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)];
  const versions = new Set<string>();
  const releases = headings.map((heading, index) => {
    const version = heading[1]!;
    if (!RELEASE_VERSION.test(version) || versions.has(version)) {
      throw new Error(`Invalid or duplicate changelog version: ${version}`);
    }
    versions.add(version);
    const body = markdown
      .slice(heading.index! + heading[0].length, headings[index + 1]?.index)
      .trim()
      .replace(/\n---\s*$/, "")
      .trim();
    if (!body) throw new Error(`Changelog ${version} has no release notes.`);
    return { version, date: heading[2]!, markdown: body };
  });
  if (releases.length === 0) throw new Error("CHANGELOG.md has no versioned release notes.");
  for (let index = 1; index < releases.length; index++) {
    if (compareSemverVersions(releases[index - 1]!.version, releases[index]!.version) <= 0) {
      throw new Error("Changelog releases must be newest first.");
    }
  }
  return releases;
}

export function changelogBetween(markdown: string, current: string | null, target: string): string {
  return parseChangelog(markdown)
    .filter(
      (release) =>
        compareSemverVersions(release.version, target) <= 0 &&
        (current === null || compareSemverVersions(release.version, current) > 0),
    )
    .map((release) => `## [${release.version}] - ${release.date}\n\n${release.markdown}`)
    .join("\n\n---\n\n");
}
