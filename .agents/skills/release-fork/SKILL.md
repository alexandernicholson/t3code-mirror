---
name: release-fork
description: Prepare a completed change in this fork for source updates by bumping VERSION, synchronizing release packages, and adding CHANGELOG.md notes. Use before handing off a completed code or documentation change; excludes unrelated repositories and incomplete work.
---

# Release a fork change

The Linux service follows a branch in this repository and builds its exact commit. `VERSION`, code, and `CHANGELOG.md` must describe the same completed change.

- Use `vp run release:change --patch --note "Describe the user-visible change"`. Choose `--minor`, `--major`, or `--version X.Y.Z` when the scope warrants it. This synchronizes the releasable package manifests; do not bump them independently.
- Bump once per completed change, not once per edit or review fix. Add further notes to that change's new section as needed. Keep older sections unchanged.
- When the change is a major feature or bug fix not present upstream, amend the root `README.md` **Differences from upstream** list. Revise or remove entries when upstream adopts the same behavior.
- Changelog sections use `## [X.Y.Z] - YYYY-MM-DD`, newest first, with `---` between releases. Explain changes in product language; mention migrations, restart effects, or compatibility limits when users need to act.
- Before handoff, run `vp run release:check`. Before merging, rebase and run `vp run release:check --base origin/main` (substitute the actual target branch). Resolve concurrent version bumps and preserve both changes' notes.
- Migrations already included in a released version must not be edited or reused under the same ID. Add a new migration. Returning from an experimental branch requires its applied migrations to remain present and identical in the target branch.
- Branch builds include their Git commit in the runtime identity. Do not write a commit hash into `VERSION` or manually change launcher protocol requirements to bypass preflight.

These commands only edit or validate local files. Commit, push, publish, and install the bootstrap only when authorized. See [the user update guide](../../../docs/user/updating.md) for the operating lifecycle.
