# Code tools

Code tools give agents language-server diagnostics, symbol navigation, renames, and code actions. Open **Settings → Tools & MCP servers → Code tools** and select the environment where your project runs. Mobile manages the same environment-owned tools.

## Install and configure servers

Choose **Install when needed** to download a supported server the first time it is needed, or **Install manually** to control installation yourself. You can search the available tools and install a specific version in Settings. Installation progress is shared across connected clients; closing Settings does not cancel it.

Managed installations use [mise](https://mise.jdx.dev/) and live in the environment's T3 data directory. T3 uses project-local language servers when available, then managed installations and commands on the environment's PATH. Custom servers can specify their command, arguments, file extensions, project root markers, and server options. Install languages not included in the catalog using their normal installation instructions, then configure their command here. Some servers need an existing project toolchain, such as Swift or Rust.

Installed binaries are shared across projects. Running servers keep separate state for each worktree and language-project root. Updates take effect for new sessions; stop existing sessions in Settings to use an update immediately. Removing a server requires stopping its active sessions. With automatic installation enabled, a removed server can be installed again when needed; disable it or choose manual installation to prevent that.

## Check and navigate code

Open **Code checks** from the right panel, the command palette, or `/checks`. File previews also offer **Code tools** with the file and line already selected. On mobile, `/checks` opens the checks sheet.

Checks inspect changed files and report unavailable tools separately from successful checks. **Observe** shows findings. **Guide the agent** sends eligible new errors on changed lines to a running agent, with a configurable limit of zero to three corrections per turn. Existing findings are recorded before a guided turn, and stopped turns are not restarted. Checks run after file changes; they do not guarantee that an invalid edit is blocked before it is written. Large change sets are bounded and identify incomplete coverage.

Environment defaults can be overridden for a project or thread. Turning automatic checks off still allows manual checks and navigation. The navigation controls provide definitions, references, type information, symbols, renames, and code actions. Select a server identifier when multiple servers handle the same file.

Renames and supported code actions produce a preview before application. Changed files invalidate that preview. Actions that require server commands or filesystem resource operations must be applied in an editor. Plan mode permits inspection and previews but not applying edits.

T3 exposes these tools through its built-in agent connection. Provider-native subagents can name a registered linked worktree from the same repository when requesting a code tool. An external shared OpenCode server does not receive T3's thread credentials; use a T3-managed OpenCode session for the built-in agent tool. Client controls and automatic checks remain available with external OpenCode sessions.

## Add project rules

Rules belong to your project. T3 does not include regex or structural coding-policy patterns. Set a workspace-relative rules file in Code tools, or reference it in `t3.json`:

```json
{
  "codeTools": {
    "rulesFile": ".code-rules.json"
  }
}
```

A rules file contains a `rules` array. For example, a team can add guidance for a compiler diagnostic:

```json
{
  "rules": [
    {
      "id": "changed-api-types",
      "files": ["src/**/*.ts"],
      "severity": "error",
      "message": "Check compatibility with the public API before changing this type.",
      "match": { "type": "diagnostic", "source": "typescript", "codes": ["2322"] }
    }
  ]
}
```

Regex rules use `match.type: "regex"` and a `pattern`. Structural rules use `match.type: "ast"`, a `pattern`, and an ast-grep `language`; ast-grep can be installed from Code tools. Invalid rules and rules that exceed execution limits are reported as unavailable checks. Clear a scope's rules path to disable additional rules there, or choose **Inherit rules** to restore the project or environment setting.
