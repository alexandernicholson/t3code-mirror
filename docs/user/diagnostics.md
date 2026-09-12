# Diagnostics

Open **Settings → Diagnostics** on web or desktop to inspect the connected
server's health. The **Server Logs** section shows a bounded recent tail,
retention statistics, dropped records, and file-write failures. Use the folder
button to open the complete retained logs on the server host.

The active application log is stored at:

```text
<T3 home>/userdata/logs/server.log
```

Development servers that use an implicit development home use
`<T3 home>/dev/logs/server.log`. Rotated files use `.1`, `.2`, and so on. The
server keeps the files within a bounded size, age, and total-disk budget.

Server logs are structured JSON Lines and are redacted and truncated before
being written. Trace data, provider event logs, and terminal history remain in
their own files. Mobile does not currently include the Diagnostics screen; use
the server host's logs folder or triage output there.

For support or disk-constrained installations, the server log limits can be
adjusted with `T3CODE_SERVER_LOG_MAX_BYTES`,
`T3CODE_SERVER_LOG_MAX_FILES`, `T3CODE_SERVER_LOG_MAX_TOTAL_BYTES`,
`T3CODE_SERVER_LOG_MAX_AGE_DAYS`, and `T3CODE_SERVER_LOG_BATCH_WINDOW_MS`.
