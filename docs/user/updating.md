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

## Upgrading to 0.9

This release moves threads to the new orchestration system while retaining advisors,
reviewers, code checks, TODOs, and saved queued messages. Existing migration IDs
are preserved. Pending messages imported from an older release remain paused;
resume the queue in the thread when you are ready to run them.

Update the server and refresh the web or desktop client together. Install the
matching mobile build before connecting to the updated server. Older clients use
the previous thread protocol.

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

Updates from the previous orchestration system preserve conversation transcripts but cannot carry
every kind of runtime history forward. Read [Threads from older T3 Code versions](./thread-migration.md)
before continuing an important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  T3 Code on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

## Update a connected server

The offered action depends on how the server runs:

| Action                     | What to do                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Keep the client open while it installs and reconnects. Supported background services update remotely. For a desktop-hosted server, this also closes and relaunches the desktop app on the host. |
| **Update the desktop app** | Update the desktop app on the machine running the server, then reopen it if needed.                                                                                                             |
| **Copy update command**    | Run the command on the named host to update the detected global npm install, then restart the server with your usual options.                                                                   |
| **Copy relaunch command**  | Stop the command-line server on its host and relaunch with the copied command, keeping your usual subcommand and options. This does not update an installed `t3` command.                       |

On the host, run:

```sh
t3 update <client-version>
```

Replace `<client-version>` with the version shown in the notice. The command
asks before restarting the background service; if you decline, run
`t3 service restart` when you are ready. For a server you started by hand,
stop it and start it again afterwards with your usual options such as `--host`
or `--tailscale-serve`.

If you run the server with `npx` rather than an installed `t3`, there is
nothing to update on the host: stop the server and relaunch it as
`npx t3@<client-version>` with the same subcommand and options.

## If an update fails

Keep the client open until it reconnects or reports a failure. A failed service
update can roll back to the previous version. If the update still fails:

1. Retry the offered action once.
2. Check that you updated the server's machine, not only the device you are using.
3. For a command-line server, stop it and relaunch the exact version shown in the notice.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

## Mobile updates

Install mobile releases built for your fork. OTA updates are disabled unless the
build explicitly configures `T3CODE_MOBILE_UPDATES_URL`. With your own OTA service
configured, the app can download updates in the background and apply them after
saving drafts and queued messages.
