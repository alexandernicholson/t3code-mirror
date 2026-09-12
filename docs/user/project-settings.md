# Settings and project overrides

The Settings breadcrumb ends with the environment and project a change applies to. They start
at **All environments** and **All projects** and stay selected as you move between categories or
search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category, shown while a project is selected, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

For workspace mode, a project's `t3.json` preference applies when the project has no override.
Browser access changes apply when an agent session next starts.

## Project icons

Select the project and open Project to choose an icon, emoji, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

## Conversation backgrounds

Choose a background from **Workstations**, **Landscapes**, or **Abstract**. The selection applies to
every thread in the project and follows the project across connected clients. Reset the row to use
the standard conversation background again.

## Keep the default branch current

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

## Tools and MCP servers

The **Code tools** section manages language-server installation, custom servers, and code checks for each environment, project, or thread. See [Code tools](./code-tools.md) for setup and project rules.

In web or desktop, open **Settings → Tools & MCP servers**, choose an environment, and add
an HTTP server or a local command. Choose which providers and projects can use it. Local
commands run on the environment's machine. These tools are available to its conversations
from web, desktop, and mobile.

For credentials, set a secret environment variable in **Settings → Providers**, then reference
its name in the MCP server configuration. Changes, including disabling or removing a server,
apply when a provider session next starts or restarts; existing sessions keep their tools.

T3-managed servers support Codex, Claude, Cursor, Grok, and Antigravity. OpenCode, OAuth setup,
and servers configured directly in a provider remain managed through that provider.

## Secrets

Open **Settings → Secrets**, choose an environment, and add a key and value. Choose
**Environment-wide** to share it across projects, or select a project to limit access to
that project's agents. The same key can exist in both scopes. Ask your agent to store or
retrieve a secret and specify its scope.

Mark a secret **Highly sensitive** to require approval before retrieval. In chat, choose
**Allow once**, **Allow for thread**, or **Deny**. Approval shares the value with the agent
and its provider. You can revoke thread access from chat; updating or deleting the secret,
or restarting the environment, also clears that access. Agents cannot lower a secret's
sensitivity. Use Settings to change it or replace a stored value.

Values stay on the selected environment and are not displayed in Settings. Local storage
uses restricted file permissions, without encryption at rest. Approval controls access
through T3's secret tools; it does not isolate secrets from programs with filesystem access
on that machine. Bitwarden and 1Password are not connected yet.
