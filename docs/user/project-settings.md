# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions and grouping to edit.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Conversation backgrounds

Choose a background from **Workstations**, **Landscapes**, or **Abstract**. The selection applies to
every thread in the project and follows the project across connected clients. Reset the row to use
the standard conversation background again.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

## Tools and MCP servers

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
