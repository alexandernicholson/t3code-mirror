#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// Local release/bootstrap tooling uses Node directly and does not start an application runtime.
import { releasePackageFiles } from "./lib/release-packages.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { RELEASE_VERSION, parseChangelog } from "@t3tools/shared/changelog";
import { compareSemverVersions } from "@t3tools/shared/semver";

export async function checkRelease(root: string, base?: string) {
  const version = (await NodeFSP.readFile(NodePath.join(root, "VERSION"), "utf8")).trim();
  if (!RELEASE_VERSION.test(version)) throw new Error("VERSION must contain major.minor.patch.");
  const changelog = await NodeFSP.readFile(NodePath.join(root, "CHANGELOG.md"), "utf8");
  const releases = parseChangelog(changelog);
  if (releases[0]?.version !== version)
    throw new Error("The latest changelog release must match VERSION.");
  for (const file of releasePackageFiles) {
    if (JSON.parse(await NodeFSP.readFile(NodePath.join(root, file), "utf8")).version !== version) {
      throw new Error(`${file} does not match VERSION.`);
    }
  }
  if (base) {
    const files = NodeChildProcess.execFileSync(
      "git",
      ["ls-tree", "--name-only", base, "VERSION"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    if (files.trim()) {
      const previous = NodeChildProcess.execFileSync("git", ["show", `${base}:VERSION`], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      if (compareSemverVersions(version, previous) <= 0)
        throw new Error(`Bump VERSION above ${previous} after rebasing.`);
      const oldNotes = parseChangelog(
        NodeChildProcess.execFileSync("git", ["show", `${base}:CHANGELOG.md`], {
          cwd: root,
          encoding: "utf8",
        }),
      );
      for (const old of oldNotes) {
        const current = releases.find((release) => release.version === old.version);
        if (!current || current.date !== old.date || current.markdown !== old.markdown) {
          throw new Error(`Published changelog ${old.version} must remain unchanged.`);
        }
      }
    }
  }
  return version;
}

export async function changeRelease(
  root: string,
  bump: "patch" | "minor" | "major" | string,
  note: string,
) {
  if (!note.trim() || /\r|\n/.test(note)) throw new Error("Provide a one-line release note.");
  const current = await checkRelease(root);
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  const version =
    bump === "major"
      ? `${major + 1}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1}.0`
        : bump === "patch"
          ? `${major}.${minor}.${patch + 1}`
          : bump;
  if (!RELEASE_VERSION.test(version) || compareSemverVersions(version, current) <= 0)
    throw new Error("The next version must be newer.");
  const changelogPath = NodePath.join(root, "CHANGELOG.md");
  const changelog = await NodeFSP.readFile(changelogPath, "utf8");
  const date = new Date().toISOString().slice(0, 10);
  const heading = changelog.indexOf("## [");
  const writes = new Map<string, string>([
    [NodePath.join(root, "VERSION"), `${version}\n`],
    [
      changelogPath,
      `${changelog.slice(0, heading)}## [${version}] - ${date}\n\n- ${note.trim()}\n\n---\n\n${changelog.slice(heading)}`,
    ],
  ]);
  for (const file of releasePackageFiles) {
    const filename = NodePath.join(root, file);
    const json = JSON.parse(await NodeFSP.readFile(filename, "utf8"));
    writes.set(filename, `${JSON.stringify({ ...json, version }, null, 2)}\n`);
  }
  for (const [filename, contents] of writes) await NodeFSP.writeFile(filename, contents);
  return version;
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      check: { type: "boolean" },
      base: { type: "string" },
      root: { type: "string" },
      patch: { type: "boolean" },
      minor: { type: "boolean" },
      major: { type: "boolean" },
      version: { type: "string" },
      note: { type: "string" },
    },
  });
  const root = NodePath.resolve(values.root ?? process.cwd());
  const bumps = [
    values.patch && "patch",
    values.minor && "minor",
    values.major && "major",
    values.version,
  ].filter((value): value is string => typeof value === "string");
  if (!values.check && (bumps.length !== 1 || !values.note))
    throw new Error("Use --patch, --minor, --major or --version with --note.");
  const version = values.check
    ? await checkRelease(root, values.base)
    : await changeRelease(root, bumps[0]!, values.note!);
  process.stdout.write(`${version}\n`);
}
