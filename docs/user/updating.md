# Updating T3 Code

The app you use and the server running your agents can be on different machines.
Update the environment named in the notice.

## Updates from this fork

Linux environments installed as a source service check their selected branch on
startup and every 15 minutes. They build the server and web app on that machine,
even when no clients are connected. **Settings → Updates** shows the running
version, update progress, and changes since the installed release. On mobile,
expand the environment in Settings to manage its server updates.

The default policy downloads, builds, and installs updates into staging, then
restarts when agents and terminal commands have finished. Idle terminals may
remain open. A long-running terminal command can postpone the restart; finish
or close it when ready. Saved threads and settings stay in the same environment.

Choose **Automatically prepare; restart manually** to keep the current version
running until you select **Restart to update**. Database migrations happen during
that restart. **Notify only** waits for you to prepare an update. You can pause
checks or defer a particular build without losing the running version.

Enter another branch to follow experiments. Switching back to `main` uses the
same update policy. A branch missing or changing an already applied migration
is blocked; choose a branch with compatible database history. Failed builds
leave the running version alone. A failed startup trial restores the database
and previous version, and the same failed commit is not retried automatically.

The browser reconnects after a restart. The self-hosted web app reloads when it
has no pending drafts; otherwise it offers a reload action. Native desktop and
mobile application binaries still use their own update mechanisms.

## Other installation types

This fork does not check the upstream desktop feed or Expo OTA project by default.
Install updates from your fork's releases. Running `npx t3` installs the original
upstream package, not this fork, and can restore upstream telemetry defaults.
The generic update commands below describe the upstream package name; substitute
your fork's package or use your source-build workflow.

Managed server installs require `T3CODE_SERVER_PACKAGE` to name your fork's npm
package. Desktop automatic checks require an explicitly configured
`T3CODE_DESKTOP_UPDATE_URL` or `T3CODE_ENABLE_UPSTREAM_UPDATES=true` for a packaged
feed. Keep a manual security-update process if automatic checks remain disabled.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → General → Continue threads after restarts** is off by default.
Enable it to resume supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
T3 Code must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
If you previously enabled continuation for updates, enable this setting once
to allow recovery without a connected client.

## Update a connected server

The offered action depends on how the server runs:

| Action                     | What to do                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Keep the client open while it installs and reconnects. Supported background services update remotely. For a desktop-hosted server, this also closes and relaunches the desktop app on the host. |
| **Update the desktop app** | Update the desktop app on the machine running the server, then reopen it if needed.                                                                                                             |
| **Copy update command**    | Stop the command-line server on its host and relaunch with the copied command, keeping your usual startup options.                                                                              |

For a background service, run the matching version's CLI on the host:

```sh
npx t3@<client-version> service update
```

Replace `<client-version>` with the version shown in the notice. Using
`@latest` only resolves the mismatch if your client is on that release. An older
service launcher may require this local update before it supports remote updates
and rollback.

For a foreground server, the copied command is `npx t3@<client-version>`. Add
`serve` if you normally run without a browser, and preserve options such as
`--host` or `--tailscale-serve`. See
[background services](./background-service.md) for service management.

## If an update fails

Keep the client open until it reconnects or reports a failure. A failed service
update can roll back to the previous version. If the update still fails:

1. Retry the offered action once.
2. Check that you updated the server's machine, not only the device you are using.
3. For a command-line server, stop it and relaunch the exact version shown in the notice.

## Mobile updates

Install mobile releases built for your fork. OTA updates are disabled unless the
build explicitly configures `T3CODE_MOBILE_UPDATES_URL`. With your own OTA service
configured, the app can download updates in the background and apply them after
saving drafts and queued messages.
