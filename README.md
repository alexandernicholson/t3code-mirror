# T3 Code Mirror

This repository is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code),
the open-source control surface for coding agents. See the upstream project for
its product overview, supported providers, installation options, and general
documentation.

## Differences from upstream

This fork currently adds or changes the following:

- Makes product analytics, cloud connections, update checks, and hosted-service
  configuration opt-in. Bundled analytics credentials and provider-derived
  tracking identifiers are removed. See [Telemetry](./docs/user/telemetry.md)
  and the [privacy audit](./docs/privacy-audit.md).
- Adds managed MCP server configuration with project- and provider-level scope.
  See [Tools and MCP servers](./docs/user/project-settings.md#tools-and-mcp-servers).
- Adds environment- and project-scoped secret storage, agent tools for using
  secrets, and explicit approval controls for highly sensitive reads. See
  [Secrets](./docs/user/project-settings.md#secrets).
- Adds shared provider settings across clients, including configurable Codex
  model context windows. See [Codex accounts and settings](./docs/user/providers-codex.md).
- Discovers Claude gateway models for web, desktop, and mobile model selection.
  See [Claude routers](./docs/user/providers-claude.md#other-routers).
- Keeps pull-request creation, lookup, and the in-app PR viewer pointed at the
  project's configured repository instead of silently switching to its upstream.
  See [Source control integrations](./docs/user/source-control.md).
- Renders Mermaid code fences as diagrams on web and mobile, with source and
  invalid-diagram fallbacks.
- Reports cached input and cache hit rates overall, by provider, and by model.
- Lets users choose whether a mid-turn message should steer current work or enter
  a durable environment-side queue. Queued messages survive disconnects and can
  be removed, sent immediately, or restored to the editor with attachments. See
  [Steer or queue a message](./docs/user/composer.md#steer-or-queue-a-message).
- Adds on-device voice narration for concise agent progress updates, including
  downloadable offline voices and playback controls on web, desktop, and mobile.
  See [Voice narration](./docs/user/composer.md#voice-narration).
- Adds scheduled quota-recovery charts for provider usage limits on web, desktop,
  and mobile. See [Usage and cost](./docs/user/usage.md).
- Adds branch-based source updates for Linux services, with automatic, manual,
  and notification-only policies; safe preparation and activation; migration
  trials; rollback; progress; and release notes. It also permits updates when
  terminals are idle on systems without native process monitoring. See
  [Updates from this fork](./docs/user/updating.md#updates-from-this-fork).
- Adds persistent, editable thread TODOs shared across web, desktop, and mobile.
  Native provider checklists and the fallback TODO tool feed the same state, while
  user edits are reconciled back into the conversation. See
  [TODOs](./docs/user/composer.md#todos).
- Uses a fork-oriented release lifecycle and a leaner CI setup, with focused web
  browser checks and repeatable screenshot tooling for maintainers.

## Contributions

We do not accept contributions or pull requests for this fork. Please contribute
to the [upstream T3 Code project](https://github.com/pingdotgg/t3code) instead.
