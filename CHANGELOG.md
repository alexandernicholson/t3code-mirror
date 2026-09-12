# Changelog

## [0.7.0] - 2026-09-12

- Merge upstream T3 Code main through #11361: link several pull requests to a thread with GitHub stack navigation, connect simulator and emulator device hosts, override any scopable setting per project, rewind conversations while keeping file changes, set default permissions for new threads, queue messages during context compaction, and receive Android agent notifications. Linked pull requests move to a new projection table (migration 057); TODOs and code tools keep working when agent browser access is off.

---

## [0.6.0] - 2026-09-10

- Add Code tools with managed language-server installation, worktree-scoped navigation and refactoring, configurable project checks, and web and mobile controls.

---

## [0.5.7] - 2026-09-10

- Add zoom controls, drag and pinch navigation, reset, and PNG export for Mermaid diagrams on web, desktop, and mobile.

---

## [0.5.6] - 2026-09-09

- Global Narrate follows new updates across threads and pages on web, desktop, and mobile, with automatic thread voices, a shared playback queue, and persistent stop controls.

---

## [0.5.5] - 2026-09-09

- Fix stuck Advisor, Observer, and on-demand Reviewer runs and choose their accounts and models directly in the thread panels.
- Keep advisor model controls visible as activity arrives and skip reviews of empty messages, usage updates, and checkpoint bookkeeping.

---

## [0.5.4] - 2026-09-09

- Add an in-browser IDE linked to agent threads with live changed files, approval controls, conflict-safe saves, and CodeMirror editing.

---

## [0.5.3] - 2026-09-09

- Default Thinking to on for every model that exposes it, preserve explicit opt-outs, and surface Claude custom-model Reasoning, Ultracode, Fast Mode, Thinking, and context controls using live SDK capabilities where available.

---

## [0.5.2] - 2026-09-09

- Claude custom models now expose Thinking and 200k/1M context-window controls, including correct 1M model dispatch.

---

## [0.5.1] - 2026-09-09

- Track provider usage-limit percentages for 90 days and replace scheduled recovery projections with account history charts on web, desktop, and mobile. History begins after this update and includes a database migration.

---

## [0.5.0] - 2026-09-09

- Add configurable on-demand Reviewer agents with Quick and Deep runs, surfaced file findings, Fix in chat, dismissal, and a Settings library of editable Markdown rules. The built-in library covers nine testing/quality review types plus attributed Cursor Team Kit and Matt Pocock rules. Reviewers and AI rule optimization support every configured provider/model and run with full tool access; rule naming uses the title-generation model.

---

## [0.4.1] - 2026-09-09

- Let web and desktop clients replace the sidebar's T3 Code wordmark with custom text from Settings → Appearance → Sidebar title, including inline Markdown (bold, italics, strikethrough, underline, code) and emoji. Not shown in the mobile app.

---

## [0.4.0] - 2026-09-09

- Make delegated agents inspectable and messageable across web, desktop, and mobile, with durable per-agent process logs and complete Codex child tool history.

---

## [0.3.3] - 2026-09-09

- Let advisors use any configured provider and model. Reviewer sessions enforce read-only inspection, disable MCP access, and dismiss write or interaction requests across Codex, Claude, Cursor, Grok, OpenCode, and Antigravity. Improve advisor setup actions on web and mobile.

---

## [0.3.2] - 2026-09-09

- Add project-scoped conversation backgrounds with grouped workstation, landscape, and abstract choices, cover-cropped artwork, and readable glass chat surfaces across web, desktop, and mobile. Includes a database migration for the saved project selection.

---

## [0.3.1] - 2026-09-09

- Use the chat model picker and supported model options in advisor and voice-summary settings. Preserve effort, context window, and service tier selections; honor Codex context windows when generating voice summaries.

---

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
