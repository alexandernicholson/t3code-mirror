# Oh My Pi

Install and configure OMP on the machine running your environment, then enable
**Oh My Pi** in **Settings > Providers**. T3 Code runs `omp acp`, so the same
credentials, model files, profiles, extensions, skills, and project configuration
that OMP uses in a terminal apply to T3 Code sessions.

The model picker is populated from `omp models --json`. Use **Refresh provider
status** after changing OMP credentials or model configuration. You can set a
custom binary path and add launch arguments such as `--profile work` for a
separate provider instance.

OMP sessions support images, MCP servers, native slash commands, plan and code
modes, approval requests, structured questions, interruption, steering, resume,
model switching, thinking levels, and T3 Code's text-generation tasks. OMP does
not expose conversation rewind, so restoring an earlier checkpoint starts a new
provider conversation.

T3 Code maps its permission modes onto OMP's approval policy. **Supervised** and
**Auto** ask before protected actions, **Auto-accept edits** allows workspace
writes but asks before execution, and **Full access** launches OMP with its
`yolo` approval mode. OMP configuration can still explicitly deny a tool.
