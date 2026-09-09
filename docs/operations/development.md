# Development

## First checkout

Install `vp` using the [root README](../../README.md#install-vp). The checkout requires Node 24;
Bun is optional. From the repository root:

```sh
vp i
vp run dev
```

Open the one-time pairing URL printed by the dev runner. The bare origin does not authenticate
a new browser.

Prefer a container? See [Dev container](../internals/devcontainer.md) for VS Code and Codespaces setup.

## Choosing a dev process

Use `vp run dev` for server and web, or `vp run dev:desktop` for the Electron client.
`dev:server` and `dev:web` start those processes separately.
See the [mobile README](../../apps/mobile/README.md) for native builds and Metro.

Flags go directly after the task name, for example `vp run dev --home-dir /tmp/t3code-dev`.
Add `--browser` to open a browser automatically.

### State and ports

Linked worktrees default to their own `.t3/userdata`, even when `T3CODE_HOME` is set.
The main checkout defaults to `~/.t3/dev/userdata`. An explicit `--home-dir` wins in both cases.
Never run a development server against the live `~/.t3/userdata`.
See [test data](../../AGENTS.md#test-data) for copying a consistent database snapshot.

Read ports from the `[dev-runner]` output. Worktrees derive stable preferences from their paths,
but occupied ports can shift them. `T3CODE_PORT_OFFSET` or `T3CODE_DEV_INSTANCE` can select a
different preference when needed.

### Sharing and remote debugging

`vp run dev --share` publishes the web port over the machine's tailnet and prints a pairing URL
for that origin. Give the tester the complete URL, including its token. The dev runner removes
its mapping on exit.

Leave `VITE_HTTP_URL` and `VITE_WS_URL` unset. Vite proxies the backend through the browser's
origin so the same build works over localhost and remote connections.

Shared runs enable bundled dev to avoid a network round trip for each import level.
`T3CODE_BUNDLED_DEV=0` opts out when debugging bundler differences. Two reload traps matter
when changing this setup:

- The web entry must dynamically import the app so React refresh initializes before application
  chunks. Static imports can work on first load and fail after a route split.
- Bundled dev rebuilds Tailwind through watched files. Its ordinary Vite hot-update hook expects
  a server/module graph that Rolldown does not provide.

The workarounds live in the [web entry](../../apps/web/src/bootstrap.ts) and
[Tailwind plugin](../../apps/web/vite/tailwind.ts).

## Checks

Run checks for the files and packages you changed:

```sh
vp test run <files>
vp lint <files>
vp run --filter <package> typecheck
```

[CI](../../.github/workflows/ci.yml) runs formatting, lint, typechecking, release metadata
validation, and the JavaScript/TypeScript test suites in one standard Ubuntu job on PRs
and pushes to `main`. New commits cancel superseded runs. Server tests run serially
without runner sharding; this favors fewer runner setups over shorter wall-clock time.

For unused-code audits, desktop build/preload validation, release smoke tests, and Rust
formatting/tests, run CI manually with `extended` enabled. For Swift/Kotlin lint, enable
`mobile_native` to add a macOS job, or run `vp run lint:mobile` locally. These checks
are opt-in in this personal fork; ordinary CI does not validate native code or bundling.
PR size/vouch labels and transfer-report comments are disabled; transfer budgets remain
in the tests and the CI job summary. Mobile fingerprint checks run only when
`T3CODE_DEPLOYMENTS_ENABLED` is `true`, like the existing deployment workflows.

If branch protection requires the old Test, Test Server, Rust, or Release Smoke jobs,
replace those requirements with `Check` when adopting this workflow.
The [manual Windows lane](../../.github/workflows/windows-tests.yml) is available for focused
Windows investigation while that suite is not a required gate.

### Web screenshots and interaction checks

The collaborative preview requires an Electron desktop host connected to the environment.
For web-only development, use the repository-managed Chromium runner. Dev containers install
the browser and its Linux libraries during setup; other hosts can prepare them with:

```sh
vp run browser:install
# Linux, when system libraries are missing (requires package-install privileges):
vp exec playwright-core install-deps chromium
vp run browser:doctor
vp run browser:self-test
```

The self-test uses a disposable local page and validates pairing, authentication reuse,
interaction checks, screenshot output, and cleanup. It does not start T3 or test product UI.
For product verification, start `vp run dev`, prepare isolated test data, and run:

```sh
vp run screenshots:web --url http://localhost:WEB_PORT --wait-for 'YOUR_READY_SELECTOR'
vp run test:web:browser --url http://localhost:WEB_PORT --script /absolute/path/check-ui.ts
```

Use the actual printed web origin. On the first run, add `--pair-url-file FILE` with a fresh,
agent-owned pairing URL stored in an owner-only temporary file. Later runs reuse the dedicated
browser profile. PNGs and browser state default to `.t3/browser`; use a separate `--state-dir`
for each environment or concurrent run. Never publish the profile, which contains credentials.
`--output`, `--width`, `--height`, and `--full-page` control screenshot output.

Check modules export an async default function receiving `{ page, context }` and throw when
an expectation fails. Use visible UI conditions instead of sleeps. See
[the web testing skill](../../.agents/skills/test-t3-app/SKILL.md) for pairing, test data,
script examples, and environment reuse. The runner uses the repository-pinned
[Playwright browser API](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

### Unused code

`vp run knip:check` checks unused files and dependencies across the repo, then
unused runtime exports in `apps/server`, `apps/desktop`, `apps/web`, and every internal package under
`packages/`. The manual extended CI run enforces both checks.
Exported types and Effect schemas are allowed without consumers. The schema preprocessor
recognizes schema types, including aliases and schema classes; functions that create or decode
schemas remain checked. Canonical Effect service construction APIs stay exported with an explicit
`@public` annotation, which Knip recognizes. Completely unused files remain checked too.
Named exports in web UI component modules are kept as complete component sets. Knip ignores
unused exports in `apps/web/src/components/ui/*.tsx`, while still reporting an entire unused file.
Use `vp run knip --workspace apps/web` to audit one workspace, including exports,
or `vp run knip:production --workspace apps/web` to find code kept alive only by tests.
The full export audit still has findings and is not a repo-wide CI gate. Extend the
export check's workspace selectors as more workspaces become clean. Review callers before
deleting code; production mode can also report development scripts and test fixtures.
Runtime-discovered entrypoints and dependency exceptions belong in [knip.jsonc](../../knip.jsonc).

## Desktop artifacts

Local artifact builds are unsigned by default and write to `release/`:

```sh
vp run dist:desktop:dmg
vp run dist:desktop:linux
vp run dist:desktop:win
```

DMGs default to the host architecture. Use `--arch` to choose another target and `--keep-stage`
to retain packaging files for inspection. Run `vp run dist:desktop:artifact --help` for other
options.

### Linux AppImage prerequisites

Build on Linux because the browser-secret helper links against the host's libsecret. Install
Rust, C/C++ build tools, libsecret development headers, pkg-config, and ImageMagick.

Ubuntu and Debian:

```sh
sudo apt-get update
sudo apt-get install cargo rustc build-essential libsecret-1-dev pkg-config imagemagick
```

Fedora:

```sh
sudo dnf install rust cargo gcc gcc-c++ make libsecret-devel pkgconf-pkg-config ImageMagick
```

Arch Linux:

```sh
sudo pacman -S rust base-devel libsecret pkgconf imagemagick
```

The C toolchain, pkg-config, and libsecret headers are also needed for Linux desktop development.

### macOS DMG prerequisites

Install the Xcode Command Line Tools with `xcode-select --install` and install Rust.
For a cross-architecture or universal build, add the requested Rust targets:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Windows installer prerequisites

Install Rust, Python 3, and Visual Studio Build Tools with **Desktop development with C++**.
Include the Windows SDK and the MSVC build tools and Spectre-mitigated libraries for the target
architecture. Add its Rust target:

```powershell
rustup target add x86_64-pc-windows-msvc
# For an ARM64 installer:
rustup target add aarch64-pc-windows-msvc
```

NSIS is downloaded by electron-builder. WSL support additionally needs a Linux node-pty prebuild;
see the [release runbook](./release.md#windows-payload-topology-and-update-validation).

### Signing and passkeys

Add `--signed` after configuring the platform credentials in the
[release runbook](./release.md). macOS passkeys need a signed, provisioned app; follow the
[Connect setup](./connect-setup.md#desktop-passkeys) for local signing and renderer HMR.
