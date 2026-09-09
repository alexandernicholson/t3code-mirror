# In-browser IDE

T3 Code includes a CodeMirror-based editor in the browser, so you can edit
project files without leaving the app — on web, desktop, and remote
environments alike.

Open it from the chat header's IDE button, the command palette ("Open IDE"),
or `Cmd/Ctrl+E`. The IDE opens as a panel beside the thread; use the panel's
maximize control to expand it to fill the window.

Files you open autosave as you type. `Cmd/Ctrl+S` inside the editor saves
immediately.

## Working alongside the agent

The IDE is linked to the thread's agent. Pending approval requests appear at
the top of the panel so you can review and approve file changes where the code
is visible. The right rail lists the files the current turn has changed.

When the agent edits a file you have open, the editor refreshes automatically
if you have no unsaved edits. If you do, nothing is overwritten: the server
rejects stale saves, and the editor shows a banner with both versions so you
can compare, keep your edits, or take the agent's version.

## Editing limits

Files larger than 1 MB open read-only. Binary files, images, and videos open
in the file preview instead of the editor.
