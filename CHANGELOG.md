# Changelog

## [0.3.0] - 2026-09-09

- Add independent advisors with project and thread controls, private review timelines, live status, and pause/resume across web, desktop, and mobile. Read-only reviewer sessions currently use Claude Code and can watch any provider. Includes a database migration for advisor settings and history.

---

## [0.2.3] - 2026-09-09

- Web and desktop narration now use a configurable model and custom instructions to turn agent updates into brief spoken summaries. Summaries require a connection to the environment’s model provider. Mobile narration delivery is unchanged.

---

## [0.2.2] - 2026-09-09

- Show models discovered by Claude gateways across web, desktop, and mobile, preserving custom model settings and removing retired gateway entries after successful refreshes.

---

## [0.2.1] - 2026-09-09

- Move TODO checklists from above the composer into the right sidebar, with a toolbar inspector or sheet on mobile. Track TODO updates in the conversation and remove redundant editing guidance.

---

## [0.2.0] - 2026-09-09

- Add persistent, editable thread TODOs on web, desktop, and mobile, using native agent checklists with an OMP-style fallback. Existing checklists are migrated; user edits are shared on the next message.

---

## [0.1.7] - 2026-09-09

- Allow source updates to restart with idle terminals when native process monitoring is unavailable, while still blocking on active commands or failed process inspection.

---

## [0.1.6] - 2026-09-09

- Reduce personal-fork CI overhead with one standard Linux validation job, optional extended and native checks, and fewer PR automation jobs.

---

## [0.1.5] - 2026-09-09

- Show steer and queue in a compact delivery selector only while the agent is working, and display queued messages as single lines above the editor on web, desktop, and mobile.
- Add repeatable web development screenshots and browser checks with a managed Chromium setup and reusable authentication.

---

## [0.1.4] - 2026-09-09

- Require PR evidence to be attached directly to pull requests; prohibit releases, release assets, and tags as evidence hosting.

---

## [0.1.3] - 2026-09-09

- Add scheduled quota recovery charts to Usage Limits on web, desktop, and mobile, showing when provider account resets restore headroom without repeating cost details.

---

## [0.1.2] - 2026-09-09

- Listen to concise agent progress updates with on-device voice narration across web, desktop, and mobile. The Kitten TTS model downloads on first use, shows progress, and remains cached for offline playback.

---

## [0.1.1] - 2026-09-09

- Choose Steer or Queue across web, desktop, and mobile. Queued follow-ups persist on the environment, pause when stopped, and can be restored with attachments to the editor.

---

## [0.1.0] - 2026-09-08

### Added

- Build and update the Linux service from this fork or an experimental branch.
- Automatically prepare updates and restart when idle, or choose manual restart or notifications only.
- View update progress and release notes from connected clients.
- Release commands and agent guidance keep versions and this changelog aligned.

---
