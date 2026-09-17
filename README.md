# T3 Code Mirror

This repository is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code),
the open-source control surface for coding agents. See the upstream project for
its product overview, supported providers, installation options, and general
documentation.

## Differences from upstream

This fork currently adds or changes the following:

- Adds language-server tools, managed installations, and project-owned code checks across clients.
  See [Code tools](./docs/user/code-tools.md).

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
- Adds full Oh My Pi provider support through ACP, including native model and
  thinking options, modes, permissions, questions, skills, commands, session
  resume, MCP servers, images, and text-generation tasks. See
  [Oh My Pi](./docs/user/providers-omp.md).
- Discovers Claude gateway models for web, desktop, and mobile model selection.
  See [Claude routers](./docs/user/providers-claude.md#other-routers).
- Keeps pull-request creation, lookup, and the in-app PR viewer pointed at the
  project's configured repository instead of silently switching to its upstream.
  See [Source control integrations](./docs/user/source-control.md).
- Renders Mermaid code fences as diagrams on web, desktop, and mobile, with zoom,
  pan, PNG export, and source and invalid-diagram fallbacks.
- Lets each web or desktop client replace the sidebar's T3 Code wordmark with
  custom text, including inline Markdown and emoji. See
  [Sidebar title](./docs/user/appearance.md#sidebar-title).
- Reports cached input and cache hit rates overall, by provider, and by model.
- Lets users choose whether a mid-turn message should steer current work or enter
  a durable environment-side queue. Queued messages survive disconnects and can
  be removed, sent immediately, or restored to the editor with attachments. See
  [Steer or queue a message](./docs/user/composer.md#steer-or-queue-a-message).
- Adds Global Narrate across threads and pages, with automatic thread voices,
  a shared playback queue, and on-device speech for concise agent updates, including
  downloadable offline voices and playback controls on web, desktop, and mobile.
  See [Voice narration](./docs/user/composer.md#voice-narration).
- Tracks provider usage-limit percentages for 90 days and charts each account over
  time on web, desktop, and mobile. See [Usage and cost](./docs/user/usage.md).
- Adds branch-based source updates for Linux services, with automatic, manual,
  and notification-only policies; safe preparation and activation; migration
  trials; rollback; progress; and release notes. It also permits updates when
  terminals are idle on systems without native process monitoring. See
  [Updates from this fork](./docs/user/updating.md#updates-from-this-fork).
- Adds independent read-only advisors with account and model selection directly
  in the thread panel, project defaults, live review timelines, automatic guidance during
  active work, and pause/resume controls on web, desktop, and mobile. See
  [Advisors](./docs/user/composer.md#advisors).
- Adds configurable on-demand reviewer agents for test strategy, unit, regression,
  integration, performance, benchmark, security/fuzz, concurrency, and acceptance reviews.
  Choose an account and model in the review panel. Full-access runs surface file findings with fix/dismiss actions, backed by an editable,
  model-optimized Markdown rule library in Settings. See
  [Reviewers](./docs/user/composer.md#reviewers).
- Adds persistent, editable thread TODOs shared across web, desktop, and mobile.
  Native provider checklists and the fallback TODO tool feed the same state, while
  user edits are reconciled back into the conversation. See
  [TODOs](./docs/user/composer.md#todos).
- Adds project-scoped conversation backgrounds with grouped workstation,
  landscape, and abstract collections. See
  [Conversation backgrounds](./docs/user/project-settings.md#conversation-backgrounds).
- Makes delegated agents inspectable and messageable from web, desktop, and
  mobile, with durable per-agent process logs built from every provider's
  normalized agent and tool activity.
- Adds bounded, redacted server application logs with rotation, retention,
  remote diagnostics, and a recent-log view in web and desktop Diagnostics.
  See [Diagnostics and server logs](./docs/user/diagnostics.md).
- Uses a fork-oriented release lifecycle and a leaner CI setup, with focused web
  browser checks and repeatable screenshot tooling for maintainers.

## Contributions

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
