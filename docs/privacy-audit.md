# T3 Code telemetry and privacy audit

## Fork changes implemented

This fork now defaults to **no T3-company analytics, cloud connection, or upstream update contact**. The original audit below is retained as a historical record of the audited revision, not a description of the fork's new defaults. Its line references refer to that revision; some referenced code has since been removed.

| Boundary                          | Implemented behavior                                                                                                                                                                                                                             | Current source                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product analytics                 | Defaults off; shipped PostHog host/key removed. Disabled/incompletely configured analytics returns before identity, filesystem, HTTP, buffers, timers or shutdown delivery.                                                                      | `apps/server/src/telemetry/AnalyticsService.ts`                                                                                                                                                                                                                                                                                          |
| Analytics identity                | Provider account-file lookup and hashing removed. Explicitly configured analytics uses only a random installation ID.                                                                                                                            | `apps/server/src/telemetry/Identify.ts`                                                                                                                                                                                                                                                                                                  |
| Direct Axiom exports              | Removed web, mobile, and headless/server relay exporter installation and public tracing configuration; shared exporter removed. Local diagnostic instrumentation remains.                                                                        | `apps/web/src/lib/runtime.ts`, `apps/mobile/src/lib/runtime.ts`, `apps/server/src/server.ts`, `packages/shared/src/relayTracing.ts`                                                                                                                                                                                                      |
| Cloud/Clerk/relay/APNs            | Requires explicit cloud opt-in. Old keys, saved OAuth credentials, linked environments, or saved tunnel state do not activate cloud by themselves. Disabled startup does not read cloud credentials or start/release managed tunnels.            | `apps/server/src/cloud/publicConfig.ts`, `apps/server/src/cloud/CliTokenManager.ts`, `apps/server/src/cloud/ManagedEndpointRuntime.ts`, `apps/web/src/cloud/publicConfig.ts`, `apps/mobile/src/features/cloud/publicConfig.ts`, `apps/mobile/src/features/agent-awareness/remoteRegistration.ts`, `apps/desktop/src/app/DesktopClerk.ts` |
| Hosted pairing/login              | No automatic `app.t3.codes` fallback. Direct HTTPS pairing stays direct; hosted flows require an explicitly configured app URL.                                                                                                                  | `apps/web/src/hostedPairing.ts`, `apps/server/src/cli/connect.ts`                                                                                                                                                                                                                                                                        |
| Desktop updates                   | Legacy packaged feeds are ignored by default. A custom update URL or explicit upstream-feed opt-in is required. Build tooling no longer derives an update feed from `GITHUB_REPOSITORY`.                                                         | `apps/desktop/src/updates/DesktopUpdates.ts`, `scripts/build-desktop-artifact.ts`                                                                                                                                                                                                                                                        |
| Model catalog/server installation | Bundled model manifest works offline; network refresh requires an explicit URL. Pinned runtime installation requires an explicit fork npm package.                                                                                               | `apps/server/src/provider/ModelManifest.ts`, `apps/server/src/cloud/pinnedRuntime.ts`                                                                                                                                                                                                                                                    |
| Mobile OTA/native identity        | Upstream Expo update URL, EAS owner/project, Apple team/relying-party defaults, and App Store submit ID removed. Fork-owned configuration is optional and explicit.                                                                              | `apps/mobile/app.config.ts`, `apps/mobile/eas.json`                                                                                                                                                                                                                                                                                      |
| Build/deployment telemetry        | Removed client tracing env projections, release tracing-token artifacts/injection, and unused relay client/mobile ingestion provisioning. Self-hosted relay Worker tracing still belongs to the operator's explicitly provisioned Axiom account. | `scripts/lib/public-config.ts`, `.github/workflows/release.yml`, `infra/relay/src/observability.ts`, `infra/relay/scripts/deploy.ts`                                                                                                                                                                                                     |
| Contributor data/triage           | Cursor event-forwarding workflow removed. Triage no longer fetches upstream instructions, searches upstream issues, or assumes an upstream reporting destination.                                                                                | `apps/server/src/cli/triagePrompt.ts`, `.github/triage/PLAYBOOK.md`                                                                                                                                                                                                                                                                      |
| Deployment safety                 | Release, hosted web preview, relay, and mobile EAS deployment jobs require the repository variable `T3CODE_DEPLOYMENTS_ENABLED=true`; hosted app/marketing targets must be explicitly configured.                                                | `.github/workflows/release.yml`, `.github/workflows/deploy-relay.yml`, `.github/workflows/web-preview.yml`, `.github/workflows/mobile-eas-preview.yml`, `.github/workflows/mobile-eas-production.yml`                                                                                                                                    |

### Explicit configuration, not required for local use

- Cloud: `T3CODE_CLOUD_ENABLED=true` plus your Clerk/relay configuration; build the clients with the same opt-in. Hosted flows additionally need `T3CODE_HOSTED_APP_URL`.
- Custom desktop feed: `T3CODE_DESKTOP_UPDATE_URL`; packaged-feed opt-in: `T3CODE_ENABLE_UPSTREAM_UPDATES=true`. `T3CODE_DISABLE_AUTO_UPDATE=true` still disables updates.
- Packaged desktop feed: explicitly set `T3CODE_DESKTOP_UPDATE_REPOSITORY` when building. Do not point it at upstream unless you intend to install upstream code.
- Model refresh: `T3CODE_MODEL_MANIFEST_URL`; pinned server installation: `T3CODE_SERVER_PACKAGE`.
- Mobile OTA: `T3CODE_MOBILE_UPDATES_URL`; optional EAS project/owner: `T3CODE_MOBILE_EAS_PROJECT_ID`, `T3CODE_MOBILE_EXPO_OWNER`.
- Signed native cloud identity: your `T3CODE_IOS_APPLE_TEAM_ID`, `T3CODE_CLERK_RELYING_PARTY`, and desktop signing configuration.
- Optional operator-owned analytics: all of `T3CODE_TELEMETRY_ENABLED=true`, `T3CODE_POSTHOG_HOST`, and `T3CODE_POSTHOG_KEY`. There is no built-in T3 project.

Changing a build-time setting requires rebuilding/reinstalling the client. These source changes do not modify an already-installed upstream app or delete credentials/history from live user state.

**Intentionally unchanged:** selected AI providers (including explicit provider feedback), local logs/caches/captures/terminal history, Google favicons/remote media, local client-presence reports, direct/SSH/Tailscale connections, and explicitly configured server/desktop OTLP collectors. These are not default transfers to T3's company. This is not an offline mode or a blanket third-party network ban.

### Fork verification

- 323 tests passed across 29 focused test files, including disabled analytics,
  provider-independent identity, stored cloud/tunnel opt-out, native push gating,
  desktop feed selection, and explicit self-hosted configuration.
- Changed TypeScript files pass targeted lint; the five changed workflow files
  parse as YAML without duplicate keys.
- Standalone smoke checks exercised the real analytics service with no filesystem,
  HTTP, host, or server services, and the real mobile configuration with both stale
  disabled credentials and explicit fork-owned cloud/OTA configuration.
- No app/browser was launched and no production telemetry endpoint was exercised.
  Local test transports and mocked relay/APNs responses were used.
- Mobile-wide typechecking reports navigation `RootParamList`/`never` errors in
  untouched files; those navigation types were not changed as part of this work.

## Original upstream audit — historical

Audit date: 2026-09-08. Source revision: `5a18fb95e49ea8352963329f32d5e85cf3125e24`.

## Scope and interpretation

This is a static, source-based audit of this checkout, not an assessment of anyone's intentions. It covers the server, web, desktop, mobile, marketing site, shared clients, relay, native helpers, and relevant development/deployment configuration. Source references use repository-relative `file:line` ranges and are specific to this revision.

“Sent” below means the implementation sends data when its stated trigger and configuration apply; no production traffic was captured. The app was not launched, no browser was opened, no credentials or live user databases were read, and no test telemetry was sent. Hosted infrastructure settings, recipient retention/access policies, released binaries, external provider CLI internals, OS-level reporting, and transitive dependency behavior cannot be certified from this checkout. Absence of a matching SDK is not proof of absence of all tracking.

Classifications:

- **Product analytics:** usage data sent to an analytics operator, not necessary to perform a coding task.
- **Diagnostics:** traces, metrics, process information, and logs; destinations depend on configuration.
- **Functional transfer:** data needed for a requested provider, remote connection, voice, browser, update, or other feature. Not automatically “telemetry,” but still privacy-relevant.
- **Local retention:** sensitive data stored on an environment or client; not evidence that it is uploaded to T3.

## Executive findings

1. **PostHog product analytics is enabled by default.** The server sends to `https://us.i.posthog.com/batch/` using a compiled-in project key. There is an environment-variable opt-out.
2. **The tracking identity preferentially comes from provider account files.** A SHA-256 hash of the Codex account ID, then Claude user ID, is preferred over a random installation ID. This is pseudonymous and can be stable across installations using the same account. It is not accurately described as necessarily installation-scoped anonymity.
3. **PostHog receives behavioral and device metadata, not just a startup count.** Events cover connections, thread/turn requests, model and reasoning effort, permission mode changes, approval decisions, duration, and main-agent token usage.
4. **The traced PostHog payload construction does not include prompts, responses, file contents, raw credentials, conversation IDs, or raw provider events.** This statement applies to that analytics path, not provider requests, traces, logs, relay metadata, or diagnostics exports.
5. **Disabling product analytics does not disable diagnostics or functional network traffic.** Local tracing is independently enabled; externally configured OTLP collectors receive traces and metrics. The opt-out also does not prevent the analytics identity code from reading provider account files during initialization.
6. **Axiom is another telemetry recipient.** The relay exports account-linked request traces, and configured web/desktop/mobile builds export relay-client traces directly. These are not controlled by `T3CODE_TELEMETRY_ENABLED`; a full privacy opt-out needs to address them too.

## 1. Default-on PostHog analytics

### Transport, defaults, and common payload

**Evidence:** `apps/server/src/telemetry/AnalyticsService.ts:32-45,85-93,122-154,157-200`; production wiring at `apps/server/src/server.ts:523-525`.

- Default destination: HTTPS POST to `https://us.i.posthog.com/batch/`.
- `T3CODE_POSTHOG_HOST` and `T3CODE_POSTHOG_KEY` override the host and ingestion key. The checked-in key is an ingestion project key, not evidence of an exposed administrative credential.
- `T3CODE_TELEMETRY_ENABLED` defaults to `true`. This is server-side analytics, including the server bundled with desktop; browser tracker blocking is not an effective substitute for a server-side opt-out.
- Events are buffered in memory, normally flushed every second, in batches of 20, with a nominal 1,000-event buffer and a shutdown flush. Failed batches are requeued. There is no durable event spool in this service.
- Each batch entry includes `event`, `distinct_id`, and an ISO capture `timestamp`.
- Every event adds `$process_person_profile: false`, `platform`, `arch`, `wsl` when present, `t3CodeVersion`, `clientType` (`desktop-app` or `cli-web-client`), `serverOs`, `serverArch`, `serverWslDistro` when present, `serverAppVersion`, and `serverMode`.
- WSL metadata is the actual `WSL_DISTRO_NAME` string, not only an “is WSL” boolean.
- The recipient necessarily sees the connection's public source IP and request timing; these are transport observations, not explicit event properties. Recipient-side IP enrichment, retention, and access controls were not established by this source audit. `$process_person_profile: false` does not make the event unlinkable or remove its identifier.

**Privacy concern:** automatic third-party reporting of coding activity, device characteristics, usage intensity, and permission choices. Exact model names and custom distro names can reveal internal naming conventions.

**Current control:** set `T3CODE_TELEMETRY_ENABLED=false` in the environment of **each server process before startup**. Restart existing processes. A desktop GUI launch does not necessarily inherit shell exports; remote/WSL environments require their own effective configuration. No product-analytics UI preference or `DO_NOT_TRACK` handling was found in the searched first-party implementation.

**Recommended fix:** default to disabled; provide an explicit, persisted server-level consent control surfaced in all clients; honor a documented environment override before any collection. Replace arbitrary property records with an event-specific allowlist and normalize model/distro values. Keep diagnostics consent independent and clearly named.

### Identity source and opt-out gap

**Evidence:** `apps/server/src/telemetry/Identify.ts:150-162,164-212,214-246,248-303`; `apps/server/src/telemetry/AnalyticsService.ts:85-93,125-125,182-200`.

Resolution order:

1. Read `~/.codex/auth.json`, extract `tokens.account_id`, SHA-256 hash it.
2. Otherwise read `~/.claude.json`, extract `userID`, SHA-256 hash it.
3. Otherwise read/create a persistent random UUID at the configured `anonymousIdPath`, then hash it.

The raw provider IDs and tokens are not placed in the PostHog payload. However, the hash is unsalted and deterministic: the same account ID produces the same tracking ID across installations, and someone who already possesses a candidate account ID can reproduce its hash. This is not a claim that SHA-256 can be reversed generally.

The service calls `getTelemetryIdentifier` **before** checking whether telemetry is enabled. Disabling analytics prevents record/send, but initialization can still read those provider files, create the fallback identifier, and emit identity-read warnings containing local paths. The startup heartbeat also computes project/thread counts before calling the disabled record function (`apps/server/src/serverRuntimeStartup.ts:150-171`).

**Recommended fix:** return a no-op service immediately when disabled, before identity resolution, counters, buffer allocation, or timer startup. When explicitly enabled, use a resettable random installation ID; do not inspect provider account files for analytics. Correct the “installation-scoped anonymous identifier” claim in `apps/server/src/telemetry/AnalyticsService.ts:1-5`.

### Complete identified product-event inventory

Common properties above apply to every event. Optional fields are sent only when supplied by the relevant adapter or client.

| Event                               | Trigger and event-specific properties                                                                                                                                                                                                                                                                                                                                                                       | Source                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `server.boot.heartbeat`             | Startup; `threadCount`, `projectCount`. Despite its name, the traced caller is startup, not a recurring heartbeat schedule.                                                                                                                                                                                                                                                                                 | `apps/server/src/serverRuntimeStartup.ts:150-171,920-927`                |
| `client.connected`                  | Authenticated WebSocket connection; client metadata below. Reconnects also reach this path.                                                                                                                                                                                                                                                                                                                 | `apps/server/src/ws.ts:2935-2957`                                        |
| `client.thread.started`             | Thread-create command, including a turn that bootstraps a thread; client metadata.                                                                                                                                                                                                                                                                                                                          | `apps/server/src/ws.ts:495-509`                                          |
| `client.turn.requested`             | Turn-start command; client metadata.                                                                                                                                                                                                                                                                                                                                                                        | `apps/server/src/ws.ts:495-509`                                          |
| `provider.session.started`          | Started session; `provider`, `runtimeMode`, `hasResumeCursor`, `hasCwd`, `hasModel`. CWD itself is not included.                                                                                                                                                                                                                                                                                            | `apps/server/src/provider/Layers/ProviderService.ts:1453-1461`           |
| `provider.session.recovered`        | Session recovery; `provider`, `strategy` (`adopt-existing` or `resume-thread`), `hasResumeCursor`.                                                                                                                                                                                                                                                                                                          | `apps/server/src/provider/Layers/ProviderService.ts:1174-1178,1217-1221` |
| `provider.runtime_mode.changed`     | Session restart changes permission/runtime mode; `provider`, `from`, `to`.                                                                                                                                                                                                                                                                                                                                  | `apps/server/src/provider/Layers/ProviderService.ts:1464-1474`           |
| `provider.turn.sent`                | Turn dispatch; `provider`, `model`, `interactionMode`, `runtimeMode`, `attachmentCount`, `hasInput`. Input text and attachment contents are not included.                                                                                                                                                                                                                                                   | `apps/server/src/provider/Layers/ProviderService.ts:1673-1683`           |
| `provider.turn.completed`           | Canonical completed/aborted turn; `provider`, `terminalStatus`, `usageStatus`, `usageScope`, optional `hasSubagents`, `inputTokens`, `cachedInputTokens`, `cacheCreationTokens`, `outputTokens`, `reasoningTokens`; correlated request metadata adds `model`, `effort`, `interactionMode`, `runtimeMode`, `mixedModels`, `durationMs`. Internal IDs correlate locally but are not copied into this payload. | `apps/server/src/provider/Layers/ProviderService.ts:502-549,779-817`     |
| `provider.thread.compacted`         | Compaction; `provider`.                                                                                                                                                                                                                                                                                                                                                                                     | `apps/server/src/provider/Layers/ProviderService.ts:1819-1821`           |
| `provider.turn.interrupted`         | Interrupt request; `provider`.                                                                                                                                                                                                                                                                                                                                                                              | `apps/server/src/provider/Layers/ProviderService.ts:1847-1849`           |
| `provider.request.responded`        | Approval response; `provider`, `decision`.                                                                                                                                                                                                                                                                                                                                                                  | `apps/server/src/provider/Layers/ProviderService.ts:1884-1887`           |
| `provider.session.stopped`          | Session stop, including stale-session cleanup; `provider`.                                                                                                                                                                                                                                                                                                                                                  | `apps/server/src/provider/Layers/ProviderService.ts:1301-1303,1975-1977` |
| `provider.conversation.rolled_back` | Rollback; `provider`, `turns`.                                                                                                                                                                                                                                                                                                                                                                              | `apps/server/src/provider/Layers/ProviderService.ts:2125-2128`           |
| `provider.sessions.stopped_all`     | Stop-all; `sessionCount`, followed by analytics flush.                                                                                                                                                                                                                                                                                                                                                      | `apps/server/src/provider/Layers/ProviderService.ts:2244-2247`           |

**Client metadata forwarded to PostHog:** `surface`; `appVersion` and duplicate `clientAppVersion`; `clientOs`; `clientDeviceType`; web-only `webDeployment` and `clientBrowser`; mobile-only `os` for iOS/Android, `osMajorVersion`/`clientOsMajorVersion`, `deviceModel`/`clientDeviceModel`; and `connectionMethod`. Values originate in WebSocket query parameters and are filtered for recognized enums and some string-length limits. They describe the connecting client but are attached to the server's tracking identity, not a separately consented mobile/web identity. Evidence: `apps/server/src/ws.ts:397-466,2954-2957`.

## 2. Traces and metrics: independent of PostHog

### Server OTLP export and local tracing

**Evidence:** `apps/server/src/observability/Layers/Observability.ts:19-94`; `apps/server/src/cli/config.ts:78-100,350-365`; `packages/shared/src/observability.ts:473-528`.

- Local file tracing is constructed independently of product-analytics consent. Defaults include Info minimum trace level, timing enabled, 10 MiB rotation size, 10 files, and one-second batching.
- External trace export is off when no collector is configured. `T3CODE_OTLP_TRACES_URL`, desktop bootstrap, or persisted observability settings can enable it; precedence is environment, bootstrap, then persisted settings.
- Metrics similarly use `T3CODE_OTLP_METRICS_URL` or the other configuration sources. Export interval defaults to ten seconds, service name to `t3-server`; resource properties include service runtime and server mode.
- Unsetting environment variables alone does **not** disable a collector still present in saved settings/bootstrap. `T3CODE_TELEMETRY_ENABLED=false` does not affect these exporters.
- Spans forward attributes/events and terminal exits to the delegate exporter. This is not the constrained PostHog event schema; paths, IDs, error messages, and other diagnostic attributes must be reviewed at their producers.
- HTTP header redaction is extended to include `dpop` (`packages/shared/src/httpObservability.ts:1-8`). That is a useful safeguard, not a general payload/URL/exception redaction guarantee.

**Metric inventory:** RPC request counts/durations; orchestration command counts/durations/ack durations and processed-event counts; provider session/turn/runtime-event counts and turn request durations; git command counts/durations; terminal session/restart counts. Exact metric definitions: `apps/server/src/observability/Metrics.ts:14-75`. Labels are supplied by callsites; the shared compactor preserves string/scalar values, while the model helper reduces model names to `gpt`, `claude`, `gemini`, or `other` (`apps/server/src/observability/Attributes.ts:8-49`). RPC instrumentation records method/outcome/duration, plus caller-supplied span attributes (`apps/server/src/observability/RpcInstrumentation.ts:13-104`).

**Privacy concern:** configuring a collector changes the trust boundary from local diagnostic retention to external transmission, potentially to an organization or vendor with different access/retention rules. No fixed T3-operated OTLP destination is supplied by these defaults.

**Current control:** remove collector URLs from all effective configuration sources and restart; use only trusted collectors and restrict filesystem access to traces. Do not mistake disabling trace timing for disabling tracing.

**Recommended fix:** explicit disclosure and consent when enabling external export; a clearly documented independent off switch; central redaction/allowlisting before both local and remote sinks; bounded retention and safe support-export defaults.

### Browser traces are collected by the environment, optionally forwarded

**Evidence:** `apps/server/src/http.ts:313-358`; `packages/shared/src/observability.ts:539-598`.

The authenticated OTLP proxy decodes browser spans into the local collector. When an OTLP trace URL exists, it forwards the **original JSON body** to that collector. A decode failure logs `bodyJson`, and does not itself prevent forwarding. This makes the trace channel a broader data surface than the product-event inventory. Authentication requires orchestration-operate scope; this is not an anonymous public trace endpoint.

**Recommended fix:** enforce an accepted span/attribute schema and redaction before storage/forwarding; do not log rejected trace bodies; make client-to-environment tracing and onward export separately visible to users.

### Direct Axiom tracing in web, desktop renderer, and mobile

**Evidence:** `packages/shared/src/relayTracing.ts:32-155`; `apps/web/src/lib/runtime.ts:19-24`; `apps/web/src/cloud/publicConfig.ts:41-69`; `apps/mobile/app.config.ts:404-407`; `apps/mobile/src/features/cloud/publicConfig.ts:67-71,89-96`; `apps/mobile/src/features/observability/tracing.ts:17-39`; `apps/mobile/src/lib/runtime.ts:30-37`.

This is a **third, independent trace route**, not the environment OTLP proxy:

- Web/desktop renderer tracing is constructed when all of `VITE_RELAY_OTLP_TRACES_URL`, `VITE_RELAY_OTLP_TRACES_DATASET`, and `VITE_RELAY_OTLP_TRACES_TOKEN` are available in public build configuration.
- Mobile configuration defaults the trace URL to `https://api.axiom.co/v1/traces`, but requires dataset and token too; URL alone does not enable export.
- The shared exporter posts directly to the configured URL with a bearer ingest token and `X-Axiom-Dataset`. Resource fields include service name/version, runtime, component, and client surface. Infrastructure provisions client/mobile Axiom ingest credentials and exposes build outputs (`infra/relay/src/observability.ts:45-59`; `infra/relay/alchemy.run.ts:42-47`).
- There is no product-analytics opt-out check in this exporter. It is configuration-gated, **not necessarily user-opt-in**: release/deployment tooling can supply configuration to a distributed app.

**Trace inventory:** relay authorization/cache/scopes, environment/device listing, link/unlink/status/connect, device registration/unregistration, activity snapshots, Live Activity registration, and token-cache reset; connection attempt/generation/retry and environment ID/label; authorization/descriptor/token-exchange/key-cache operations. Traces include `relay.client_id`, scopes, cache status, HTTP method/`url.full`, and operation-dependent environment identifiers. Evidence: `packages/client-runtime/src/relay/managedRelay.ts:479-628,726-937`; `packages/client-runtime/src/connection/supervisor.ts:300-339`; `packages/client-runtime/src/authorization/service.ts:256-261,289-322,353-398,497-503`.

The helper named `traceSafeError` preserves error messages, names, trimmed stacks, and recursive causes. Its safety is not a privacy-redaction guarantee: those values can contain URLs, filesystem paths, or sensitive diagnostic text. No automatic prompt/file-content collection was established here, but this is materially broader than the allowlisted PostHog payload.

**Current control:** omit all effective trace configuration from custom client builds. A server environment change alone cannot remove a URL/token already baked into a mobile/web bundle. **Recommended fix:** an explicit runtime privacy setting respected across all trace wrappers, safe URL/error redaction, environment-label minimization, and an unambiguous disclosure of the direct Axiom destination.

For comparison, ordinary web client instrumentation sends traces to the authenticated primary environment at `/api/observability/v1/traces`, using a one-second default interval (`apps/web/src/observability/clientTracing.ts:52-83`; `apps/web/src/routes/__root.tsx:190-195,430-433`). That path has the separate onward-export behavior described above.

## 3. Desktop diagnostics and sensitive browser/capture features

### Resource telemetry is not itself a third-party analytics uploader

**Evidence:** `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts:205-299,302-316,397-424`; `apps/desktop/src/backend/DesktopBackendConfiguration.ts:484-495`; `apps/desktop/src/backend/DesktopBackendManager.ts:457-490,508-526`.

The desktop publisher samples idle time, lock/suspend/battery/thermal state, speed limit, Electron PID, and—when diagnostics demand exists—process names/types, CPU, wakeups, and memory. It encodes hello messages, snapshots, and update reports as NDJSON over inherited file descriptors to the backend; a separate descriptor carries control messages. **There is no PostHog or other Internet send in this publisher.** The backend and its authorized clients are a separate disclosure boundary; “local IPC” does not mean the data cannot subsequently be viewed remotely.

**Privacy concern:** workstation presence/activity and process details are sensitive on a shared environment. Do not classify this as proof of T3 secretly uploading desktop activity to an analytics vendor.

**Recommended fix:** preserve demand-driven process sampling; disclose host activity visibility to connected clients, enforce least-privilege diagnostics access, and avoid adding these fields to product analytics.

### Desktop logs and optional OTLP

**Evidence:** `apps/desktop/src/app/DesktopObservability.ts:24-29,325-347,573-601`; `apps/desktop/src/app/DesktopConfig.ts:46-50`.

Desktop persists local logs/traces, including child-server output, separately from PostHog. Trace export uses an environment or persisted OTLP URL when configured, with a default ten-second export interval. Log/trace rotation defaults include 10 MiB and ten files.

**Current control/fix:** remove external collector settings from both environment and persisted configuration; restrict diagnostic file access and scrub sensitive errors before exports. Apply the same independent-consent and redaction recommendations as server OTLP.

### Embedded browser sessions, cookie import, and automation

**Evidence:** `apps/desktop/src/preview/BrowserSession.ts:12-40,167-209,225-258`; `apps/desktop/src/preview/BrowserImport/BrowserImport.ts:85-105,117-166,197-257`; `apps/desktop/src/preview/Manager.ts:1071-1191,1403-1498,3541-3646`.

- Preview sessions default to persistent partitions; incognito uses nonpersistent partitions. Browsing therefore retains ordinary website state unless incognito or clearing is used.
- Explicit browser import reads installed-browser cookie databases, uses OS-specific decryption/key access where needed, copies cookie values into the preview session, and flushes that cookie store to disk. This is transfer of **login credentials**, even though it is local rather than product telemetry. Source validation, browser-running checks, and OS permissions provide safeguards.
- Clear-session functionality clears cookies/site storage and cache. This does not delete independently saved artifacts or copies already sent elsewhere.
- Agent browser snapshots can include page URL/title, visible text, interactive elements/accessibility information, screenshot data, console text, failed request URLs, and action history. An authenticated imported browser session can expose private site contents to an agent via those tools.
- Website requests remain real website traffic. The favicon helper uses session credentials for same-origin fetches and omits them cross-origin (`apps/desktop/src/preview/FaviconCapture.ts:44-78,110-129`).

**Privacy concern:** importing a personal browser session expands what a coding agent can access; console/request URLs can carry secrets. Persistent cookies survive beyond an individual task. This is not evidence that the import operation sends the cookie database to T3.

**Current controls:** incognito, scoped profile/partition handling, clear-storage/cache actions, sandboxed preview windows, and OS credential permissions.

**Recommended fix:** prefer ephemeral agent browser sessions; explicitly explain cookie/account access before import; offer narrow account/domain selection and artifact deletion; redact credential-bearing URLs/console data in diagnostics; require clear consent before sharing authenticated-page captures with a provider.

### Screenshots, accessibility text, and recordings

**Evidence:** `apps/desktop/src/snapShot/DesktopSnapShot.ts:726-734,914-983,1550-1679`; `apps/desktop/src/snapShot/SnapShotAccessibility.ts:19-37,98-145`; `apps/desktop/src/preview/Manager.ts:2732-2789,3461-3499`; `apps/web/src/browser/browserRecordingUpload.ts:19-64`.

SnapShot captures foreground-window image and metadata and can include accessibility text/tree. Capture artifacts are stored locally as PNG/JSON under the desktop state directory; acknowledging a SnapShot removes its pair of files. Preview screenshots/recordings have a separate browser-artifacts directory. Completed browser recordings can be uploaded by the web client to the connected environment's attachment endpoint; captures attached to a turn become provider input.

**Privacy concern:** unrelated applications, private window titles, visible secrets, or accessibility text may be captured. A screenshot can disclose information even when no source file is attached. Local capture does not equal immediate vendor upload; attachment/automation flows create the onward transfer.

**Current controls:** explicit capture actions, OS screen/accessibility permissions, optional accessibility inclusion, bounded capture sizes, and sender/path validation.

**Recommended fix:** preview/redact before attaching; make accessibility text inclusion explicit; avoid retaining unacknowledged captures indefinitely; provide one place to delete screenshot, recording, and associated metadata artifacts.

### Automatic desktop update checks

**Evidence:** `apps/desktop/src/updates/DesktopUpdates.ts:49-50,247-265,324-346,660-700,880-923`; `apps/desktop/src/electron/ElectronUpdater.ts:85-145`; `scripts/build-desktop-artifact.ts:2572-2703`.

Packaged builds with a feed check for updates after about 15 seconds and then every four minutes. Development/unpackaged builds and other disable conditions skip this path. Feed configuration comes from packaged `app-update.yml`; build tooling configures a GitHub release feed or a local mock feed. Checks are automatic, but automatic download/install are disabled in the reviewed updater setup. The feed/CDN can observe source IP, request timing, and requested channel/platform/artifact metadata; exact dependency-generated request headers were not captured.

**Classification:** functional update traffic, not PostHog analytics. **Recommended fix:** document feed destinations and the polling cadence, provide a supported manual-only setting, and retain signed/verified update support rather than recommending permanently unpatched software.

## 4. T3 Connect, relay infrastructure, and push notifications

### Relay-side Axiom telemetry

**Evidence:** `infra/relay/src/observability.ts:19-40,215-237`; `infra/relay/src/worker.ts:282-295`; `infra/relay/src/http/Api.ts:183-190,258-268,293-300,329-338`; `infra/relay/src/environments/EnvironmentConnector.ts:396-506,542-625`.

The deployed relay wires an OTLP tracer to the provisioned Axiom endpoint, with an ingest token and `X-Axiom-Dataset`, exporting on a one-second interval. The infrastructure configures a 30-day-retention trace dataset and a view showing request method/path/status/route and `userId`. This is **separate from the local server's PostHog switch and user-configured OTLP exporter**.

Request instrumentation includes stable Clerk subject/user IDs; environment, thread, device, and endpoint identifiers appear in connector spans. Deadline logging includes the request URL. Header redaction is installed, but it does not establish that all URL/error/attribute values are sanitized.

**Privacy concern:** the hosted relay operator and its Axiom deployment can correlate account identity, connections, failures, and environment activity. The provisioned retention is evidence of intended configuration, not proof of actual production deletion or recipient access policy.

**Current control:** do not use the hosted relay if this trust boundary is unacceptable; self-hosting changes the operator but still requires reviewing the configured exporter. A local PostHog opt-out does not stop relay operator logs.

**Recommended fix:** pseudonymize identifiers in diagnostics, strip query credentials, minimize account-linked span attributes, document destinations/retention, and provide a deployment-level tracing off switch plus account-data deletion.

### Relay account/link storage and tunnel visibility

**Evidence:** `infra/relay/src/http/Api.ts:1217-1273,553-569`; `infra/relay/src/environments/EnvironmentLinks.ts:168-207`; `infra/relay/src/environments/ManagedEndpointProvider.ts:605-750,767-774,811-854`; `infra/relay/src/environments/EnvironmentConnector.ts:431-470,586-625`.

Clerk supplies authenticated account identity. The relay stores account-linked environment labels, public keys, endpoints, and capability/device metadata, and brokers signed environment health/credential requests. Managed endpoints create Cloudflare Tunnel/DNS configuration whose local service is `http://127.0.0.1:<port>`. The relay returns connector runtime credentials to the environment.

Ordinary application HTTP/WebSocket traffic goes through the managed tunnel, not through a Worker application-payload proxy; see `docs/internals/t3-connect.md:3-18,34-39`. Nevertheless, HTTPS/Tunnel transport is **not application-level end-to-end encryption that excludes the tunnel provider**. Treat Cloudflare's public HTTPS termination and the environment host as trust boundaries. Signed DPoP requests authenticate a client; they do not encrypt request bodies against those operators.

**Recommended fix:** disclose Clerk and Cloudflare roles distinctly from analytics, minimize account-linked metadata, implement account/environment deletion with retention guarantees, and add application-layer encryption only if excluding the transport operator is an actual product requirement.

The relay runtime database role inherits broad read/write roles (`infra/relay/src/db.ts:53-68`); application-level owner filters provide isolation (`infra/relay/src/environments/EnvironmentLinks.ts:314-331,360-384`). **Hardening opportunity, not a demonstrated cross-account leak:** reduce database privileges and consider row-level enforcement so a future missing owner filter has less impact.

### Agent activity sends human-readable project/thread information

**Evidence:** `packages/contracts/src/relay.ts:100-134`; `apps/server/src/cloud/config.ts:32-56`; `apps/server/src/relay/AgentAwarenessRelay.ts:121-137,258-263,323-350,388-396`; `apps/server/src/cloud/http.ts:766-769,811-819`.

When activity publishing is enabled and relay credentials exist, the environment sends agent state to the configured relay: environment/thread IDs, **project title, thread title, phase, headline, optional detail, model title**, timestamp, and deep link. Failed detail is generalized and other detail is length-bounded, but titles are still sensitive content. The server-side stored preference is false when absent; the feature can explicitly enable it.

**Privacy concern:** project/client names and task descriptions can leave the machine without being part of PostHog or an AI prompt. This is functional cloud activity sync, not merely an opaque status bit.

**Recommended fix:** make the exact fields visible before enabling; offer “status only” without titles/detail/deep links; retain default-off behavior and make disabling/deletion effective across devices.

### Apple push and Live Activities

**Evidence:** `infra/relay/src/agentActivity/ApnsClient.ts:132-183,234-277,297-361`; `infra/relay/src/agentActivity/ApnsDeliveries.ts:260-299`; `infra/relay/src/persistence/schema.ts:7-58,134-177`; `infra/relay/src/worker.ts:263-279`; `infra/relay/src/agentActivity/agentActivityPayloads.ts:15-23,43-101`; `infra/relay/src/agentActivity/apnsDeliveryJobs.ts:12-15`.

The relay posts JSON to `api.push.apple.com` or `api.sandbox.push.apple.com`. Notification/Live Activity bodies can carry title/body, environment/thread/deep-link information or aggregate activity content-state. Device records retain push/push-to-start/activity tokens and preferences; activity/delivery records retain state JSON, account/environment/thread/device identifiers, token suffixes, and delivery results/errors.

Preferences gate delivery and payload size/text are bounded. Queue jobs have a ten-minute lifetime. A cron deletes terminal activity older than 30 minutes; the source explicitly distinguishes expiring stale running/waiting rows from aggregates versus deleting their database rows. No delivery-attempt pruning path was identified. **Risk:** delivery/audit metadata or nonterminal activity rows can outlive the UI-visible activity absent an additional database policy.

Apple receives the application push payload over TLS; no application-encrypted content envelope was identified. Lock-screen/Live Activity presentation is an additional local disclosure surface.

**Recommended fix:** optional generic lock-screen messages, status-only payloads, explicit notification permission/disclosure, and enforced deletion TTLs for device tokens, stale states, aggregates, and delivery attempts. Do not equate short queue lifetime with database retention.

### SSH and Tailscale are functional transports, with diagnostic caveats

**Evidence:** `packages/ssh/src/command.ts:136-143,208-212,265-280,309-313`; `packages/ssh/src/tunnel.ts:588-599,984-1000,1086-1152`; `packages/tailscale/src/tailscale.ts:219-260,343-351,367-382`.

SSH forwards local ports through an encrypted SSH connection and can persist remote server stdout/stderr under `~/.t3/ssh-launch/<state>/server.log`. Command diagnostics include SSH targets/arguments; stdout redaction targets selected JSON token keys, while stderr and readiness-failure remote log tails have broader content. Those diagnostics can enter local traces or configured OTLP.

Tailscale integration queries the local daemon for status/IPs/MagicDNS and can explicitly configure HTTPS Serve to a loopback service. It is not a separate analytics SDK. Privacy and traffic visibility also depend on the external Tailscale daemon/service and configured network policy, which this audit did not inspect.

**Recommended fix:** sanitize command arguments, stderr, and remote log tails before diagnostic persistence/export; bound remote log retention; prefer authenticated encrypted connection modes and clearly distinguish transport encryption from application-level E2EE. Do not publish pairing URLs or server logs containing credentials.

## 5. Provider transfers, credentials, and local retention

### Coding and helper-generation requests

**Evidence:** `apps/server/src/provider/Layers/ProviderService.ts:1515-1565`; `apps/server/src/provider/Layers/CodexAdapter.ts:2475-2504,2526-2537`; `apps/server/src/provider/Layers/CursorAdapter.ts:1008-1041`; `apps/server/src/provider/Layers/GrokAdapter.ts:1520-1553`; `apps/server/src/provider/Layers/OpenCodeAdapter.ts:3092-3108,3194-3228`.

Normal turns send text and attachments to the chosen provider integration. Depending on adapter, image bytes are converted to base64/data URLs or sent as SDK file parts. Prompt preparation can add absolute attachment paths and captured-window application/title/accessibility metadata. All six provider families—Codex, Claude, Cursor, Grok, OpenCode, Antigravity—are external runtime trust boundaries, not made private by the PostHog switch. The exact onward network behavior and vendor retention of installed provider runtimes require separate audits.

Helper generation also sends code outside the conversation UI: commit/PR prompts include staged summaries and patches; branch/title prompts include the user message and attachment metadata. Bounds reduce size, not sensitivity. Evidence: `apps/server/src/textGeneration/TextGenerationPrompts.ts:37-58,108-130,144-179,291-304`; `apps/server/src/textGeneration/CodexTextGeneration.ts:118-149,180-218`; `apps/server/src/textGeneration/ClaudeTextGeneration.ts:220-226`; `apps/server/src/textGeneration/OpenCodeTextGeneration.ts:189-251`.

**Current controls:** selected provider/model, attachment validation/size limits, provider permissions, and tool restrictions for helper generation.

**Recommended fix:** disclose the receiving provider on each sending action, including commit/PR/title generation; avoid embedding local absolute paths when unnecessary; preview screenshot/accessibility metadata; support locally operated models where the provider supports them. Do not claim that disabling telemetry prevents intentional code/prompt transmission.

### Provider subprocess environment inheritance

**Evidence:** `apps/server/src/provider/ProviderInstanceEnvironment.ts:5-20`; `apps/server/src/provider/Layers/CodexSessionRuntime.ts:1206-1222`; `apps/server/src/serverSettings.ts:131-173,505-528,586-665`; `apps/desktop/src/backend/DesktopBackendConfiguration.ts:80-139,643-688`.

Provider environment merging defaults to the server's `process.env`. This can expose unrelated API keys, proxy credentials, or deployment secrets to provider subprocesses—not proof that those secrets are actually uploaded. Per-instance sensitive variables are separated into the secret store and redacted from client settings, which is a useful existing safeguard. Windows-to-WSL startup explicitly forwards OpenAI/Anthropic API-key variables, extending their exposure to the distro.

**Recommended fix:** construct a documented minimal inherited environment, with explicit per-provider additions; preserve necessary auth/PATH/platform variables without passing every ambient secret. Make cross-environment credential forwarding visible and keep those values out of diagnostic errors.

### Codex feedback explicitly requests logs

**Evidence:** `apps/server/src/provider/Layers/ProviderService.ts:2140-2177`; `apps/server/src/provider/Layers/CodexAdapter.ts:2621-2628`; `apps/server/src/provider/Layers/CodexSessionRuntime.ts:2439-2448`.

The feedback action calls Codex app-server `feedback/upload` with `classification: "bug"`, **`includeLogs: true`**, optional reason text, and the provider thread ID. This is a separate user-triggered provider upload, not PostHog analytics. The final upload destination and exact log archive content are owned by the external Codex implementation; the source proves the request to include logs, not the contents of that archive.

**Recommended fix:** clear pre-upload disclosure and granular consent for logs, a preview/redaction path where the provider protocol permits it, and a no-logs option. Unsupported adapters are rejected rather than silently uploaded through another provider.

### Provider event logs retain richer content than analytics

**Evidence:** `apps/server/src/provider/Layers/ProviderEventLoggers.ts:65-88`; `apps/server/src/provider/Layers/EventNdjsonLogger.ts:20-58,186-260,326-356,580-671`.

The default event logger creates native and canonical provider logs under the configured provider-event path. It filters many transient text/audio deltas, but that is not complete content redaction: nontransient events, tool input/output, final items, and errors can remain. JSON records are timestamped and segmented by thread. Defaults include 10 MiB per file, ten files, a 512 MiB total bound, 14-day age retention, and five-minute retention maintenance.

**Privacy concern:** local logs can contain code, tool results, identifiers, or secrets even when the analytics payload cannot. Copying them into a support issue or external collector creates a new disclosure.

**Recommended fix:** minimize/allowlist native event fields, disable sensitive event persistence by default or make it explicit, shorten configurable retention, and provide deletion/export-redaction controls. Keep rotation—it bounds volume but does not remove secrets.

### Imported history and authenticated diagnostics

**Evidence:** `apps/server/src/project/AgentSessionScanner.ts:1-12,61-95`; `apps/server/src/project/AgentSessionImporter.ts:99-103,200-203,274-276`; `apps/server/src/diagnostics/TraceDiagnostics.ts:84-90,223-236,319-336,393-408`; `apps/server/src/ws.ts:2012-2025`; `apps/server/src/auth/RpcAuthorization.ts:53-58`.

Explicit provider-history import copies user/assistant transcript messages from provider-owned local files into T3's durable thread history. This creates an additional retained copy, not an analytics upload.

Authenticated diagnostic APIs can return local trace file paths, names/IDs, failures, and recent warning/error text to connected clients. Process diagnostics add PID/command/resource details (`apps/server/src/diagnostics/ProcessDiagnostics.ts:60-86`). Trace producers demonstrably annotate local paths and IDs, for example `git.cwd`, `terminal.cwd`, and `provider.thread_id` (`apps/server/src/vcs/GitVcsDriverCore.ts:873-876`; `apps/server/src/terminal/Manager.ts:2194-2196`; `apps/server/src/provider/Layers/ProviderService.ts:1585-1589`).

**Recommended fix:** disclose the extra transcript copy and delete it with the imported thread; minimize diagnostic paths/commands/error text; consider a separate sensitive-diagnostics scope rather than treating all read access as permission to inspect workstation details.

### Authentication metadata and pairing credentials at rest

**Evidence:** `apps/server/src/auth/SessionStore.ts:418-420,621-675`; `apps/server/src/persistence/AuthSessions.ts:24-43,215-238,283-307,327-332`; `apps/server/src/persistence/AuthPairingLinks.ts:19-24,128-151,192-210`; `apps/server/src/auth/PairingGrantStore.ts:241-259,377-392`; `apps/server/src/startupAccess.ts:125-146`.

Sessions retain labels, IP/user-agent/device/OS/browser and connection metadata alongside issue/expiry/revocation times. Default signed-session lifetime is 30 days and WebSocket tickets five minutes. Active-list filtering is not deletion; no expired-session metadata purge was identified in this path.

Pairing-link storage contains the credential value. Ordinary pairing grants have a short lifetime; bootstrap/dev paths can use 24 hours. Startup output can print tokens, pairing URLs, and QR codes, so captured terminal/server logs become sensitive while a grant remains usable. Exact rights and lifetime depend on the grant path; not every displayed URL has identical privileges.

**Current safeguards:** expiry/revocation/consumption logic and authenticated session checks. **Recommended fix:** hash reusable lookup credentials at rest where protocol-compatible, keep pairing output out of diagnostic logs/exports, shorten privileged bootstrap exposure, and purge expired/revoked credential and connection metadata on a defined schedule. Treat local SQLite and backups as sensitive—not as harmless “settings.”

### Terminal output and bearer asset URLs

**Evidence:** `apps/server/src/terminal/Manager.ts:92-95,1540-1548,1706-1717,1750-1806,1854-1900,3019-3033`; `apps/server/src/http.ts:368-448`; `apps/server/src/assets/AssetAccess.ts:54-58,260-269`.

Terminal history is stored in per-thread/per-terminal log files, bounded to 5,000 lines/8 MiB, restored across sessions, and deleted through explicit history/thread cleanup. No age-based expiry was identified. Command output can contain secrets.

Asset URLs authorize downloads using a signed bearer token rather than a session cookie on the asset route. The default asset-token lifetime is one hour; upload-token lifetime is ten minutes. A copied valid URL can therefore disclose a private attachment to someone who can reach the environment until it expires. Signing and path validation protect against tampering, not onward sharing of the intact URL.

**Recommended fix:** configurable age retention for terminal history; warn before diagnostic export; shorten sensitive asset URL lifetimes, prevent referrer/log leakage, and consider session binding where cross-client media rendering permits it.

### Cloud sign-in credentials and environment descriptors

**Evidence:** `apps/server/src/cloud/CliTokenManager.ts:119-129,244-264,340-367,429-446`; `apps/server/src/cloud/http.ts:377-399`; `apps/server/src/environment/ServerEnvironment.ts:188-229`.

Cloud sign-in stores access/refresh credentials, expiry, and optional identity in the server secret store and sends refresh requests to the configured OAuth token endpoint. Explicit sign-out clears the local secret; refresh credentials can otherwise remain usable across launches. Environment linking sends a signed descriptor including label, platform/version/capability information and endpoint/public-key material to the relay.

**Recommended fix:** document credential location and sign-out behavior, apply idle/expiry cleanup, revoke linked devices/environments when appropriate, and minimize environment descriptors. Secret-store use is not, by itself, evidence of hardware-backed encryption or a remotely safe backup.

### Catalog and installation downloads

**Evidence:** `apps/server/src/provider/ModelManifest.ts:31-34,300-408`; `apps/server/src/provider/AntigravityInstallation.ts:570-635`.

The model manifest fetches `https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json` on an hourly refresh path when `enableProviderUpdateChecks` permits network checks. The request is catalog retrieval, not a prompt/code upload. Antigravity installation downloads a pinned Google release asset and validates size/hash. External recipients can observe download metadata and source IP; downstream CLI installers/updaters remain separate third-party boundaries.

**Recommended fix:** document update/catalog endpoints and honor manual-only controls consistently; do not disable security updates without an alternative maintenance plan.

## 6. Client presence, mobile behavior, local caches, and remote media

### Periodic client activity reports

**Evidence:** `apps/web/src/lib/backgroundActivityReporter.ts:13-85,180-243`; `apps/mobile/src/connection/background-activity.ts:25-104`.

Web/desktop renderer and mobile report activity to connected environments every 25 seconds and on relevant state changes. Payloads include a stable client identifier, client kind, visible/focused/recently-interacted state, mobile app state, timestamp, and retained subscription scopes. Scopes can identify a VCS working directory, provider instance, thread, or diagnostics demand. Reports have a 45-second TTL.

**Classification:** presence/resource-management telemetry sent to the selected environment, not directly to an analytics vendor. A remote environment's operator can observe it. The TTL governs liveness; it is not proof that no surrounding request logs retain metadata.

**Recommended fix:** disclose presence reporting, rotate/minimize identifiers and scope details, and allow a privacy-preserving mode that still supports required background-work scheduling.

### Mobile device registration and notification defaults

**Evidence:** `packages/contracts/src/relay.ts:46-62,89-93`; `apps/mobile/src/features/agent-awareness/registrationPayload.ts:7-43`; `apps/mobile/src/features/agent-awareness/remoteRegistration.ts:162-223,245-282,704-733,798-817,875-909,1055-1059`.

iOS registration can send device ID/label, iOS/app version, bundle ID, APNs environment, push/push-to-start token, and notification preferences to the configured relay. Live Activity registration sends an activity push token. Registration depends on platform/build capability, cloud sign-in/connection and permission state. Notification event flags default to true; Live Activities are enabled unless explicitly disabled. Sign-out unregisters/clears registration, and settings expose a Live Activities toggle.

**Privacy concern/fix:** stable device identity and human device names join cloud account/activity data. Make defaults and exact fields clear at registration; offer generic names and per-event preferences; ensure “remove device” also deletes stale tokens and delivery records. This complements the relay/APNs findings, rather than adding a separate analytics vendor.

### Microphone and transcription

**Evidence:** `apps/mobile/src/features/voice-input/useVoiceInputController.ts:29-58,90-123`; `apps/mobile/src/native/voiceTranscription.ios.ts:36-59,79-98`; `apps/mobile/src/native/voiceTranscription.ts:1-5`; `packages/client-runtime/src/voice-input/controller.ts:189-243,360-453`.

Dictation requests microphone permission, records locally with metering and background recording disabled, reads the recording bytes, and invokes the native Apple transcription interface. The generic platform adapter returns no transcriber; this is not an Android cloud-STT fallback. Cleanup deletes owned temporary recording files and the returned text enters the composer.

No explicit audio network upload was identified in this adapter. Native Apple implementation/OS service behavior remains a separate boundary; the TypeScript call alone cannot certify all OS-level networking. Sending the resulting composer text is the ordinary provider transfer.

Provider realtime audio is distinct: Codex notifications can contain transcript/items/audio; T3 maps and relays them, filtering transient audio deltas from provider event logs but not necessarily all final items (`apps/server/src/provider/Layers/CodexAdapter.ts:2022-2075`; `apps/server/src/provider/Layers/EventNdjsonLogger.ts:39-58`).

**Recommended fix:** document the native processing/temporary-file guarantee, make microphone state clear, and avoid retaining final audio/transcript objects in diagnostics without explicit consent.

### Mobile automatic Expo updates

**Evidence:** `apps/mobile/app.config.ts:178-193`; `apps/mobile/src/features/home/HomeRouteScreen.tsx:39-42`; `apps/mobile/src/features/updates/app-updates.ts:133-153,240-383,559-622`.

OTA updates are enabled with `checkAutomatically: "ON_LOAD"` and destination `https://u.expo.dev/d763fcb8-d37c-41ea-a773-b54a0ab4a454`. Application logic also checks on launch/foreground re-entry, with development/disabled-build gates, and can fetch/apply updates. This is automatic update-service traffic, independent of PostHog. Native Expo request headers/identifiers and service-side retention were not captured.

**Recommended fix:** disclose Expo as a recipient, review the native SDK's exact metadata, and offer an operationally safe manual-only policy. Baked configuration and OTA-delivered code are part of the trust model for future telemetry changes.

### Browser/mobile caches retain prompts and credentials

**Evidence:** `apps/web/src/connection/storage.ts:24-55,280-317,450-669`; `apps/web/src/composerDraftStore.ts:83-125,2084-2183`; `apps/web/src/browserHistoryStore.ts:13-18,141-190,280-287`; `apps/mobile/src/persistence/mobile-storage.ts:13-22,51-58,130-219`; `apps/mobile/src/persistence/mobile-database.ts:214-446`; `apps/mobile/src/state/use-composer-drafts.ts:331-399`; `apps/mobile/src/state/thread-outbox-storage.ts:1-132`.

- Browser IndexedDB holds connection/auth/token and cached environment/thread data; desktop can delegate catalog storage through its secure bridge.
- Browser localStorage drafts can contain prompt text, inline images, file/terminal context, selected page HTML/styles/URL/title, and review annotations. Browser history retains URLs/titles per project.
- Mobile SecureStore holds connection/credential/device-registration material. Separately, SQLite caches retain offline thread/environment/VCS data.
- Mobile draft and queued-message JSON files under the app Documents directory retain text, attachment references/inline images, model/mode, and project/worktree metadata without application-level encryption shown at those writers.
- The mobile cache-clearing UI explicitly leaves connections, credentials, account data, and preferences intact; it does not constitute a wipe of drafts/outbox/secure credentials (`apps/mobile/src/features/settings/SettingsClientStorageRouteScreen.tsx:30-73,145-174`; `apps/mobile/src/state/client-cache-state.ts:62-89`).

**Privacy concern:** unsent drafts and queued turns are sensitive too; signing out or clearing “cache” is not necessarily deleting them. OS sandbox/disk protection remains relevant, but these writers are not evidence of encrypted backup-safe application storage.

**Recommended fix:** a clearly scoped “clear all local sensitive data” action, draft/outbox-specific cleanup, bounded offline retention, and documented secure-credential revocation/deletion semantics.

### Remote images and Google favicon requests

**Evidence:** `packages/client-runtime/src/markdownImages.ts:17-66`; `packages/client-runtime/src/mediaSource.ts:31-91`; `apps/web/src/components/ChatMarkdown.tsx:1204-1221,1360-1430`; `apps/mobile/src/features/threads/ThreadFeed.tsx:2178-2250`; `apps/mobile/src/features/threads/ThreadMarkdownImage.tsx:146-164`; `packages/shared/src/favicon.ts:85-97`.

Rendered markdown can load authored HTTP(S)/protocol-relative media URLs directly. A model response containing an image URL can therefore cause a third-party request during rendering, not only after clicking a link. A remote image operator can observe client IP, timing, and any identifier embedded in its URL; referrer behavior depends on client/browser policy. This is a potential tracking-pixel channel, **not evidence of a fixed T3 tracking pixel**.

Public-host link icons use Google's favicon service, sending the linked public host to Google. Private/reserved-host checks suppress those favicon lookups, but they do not prevent arbitrary remote markdown media loads.

**Recommended fix:** opt-in remote media or a carefully designed privacy proxy, explicit no-referrer policy on web media, no third-party favicon lookup by default, and clear external-site indicators. A proxy changes who sees the request; it does not automatically make it anonymous.

### Manual error reports and marketing downloads

**Evidence:** `apps/web/src/routes/__root.tsx:320-375,405-438`; `apps/marketing/src/lib/releases.ts:3-10,24-50`; `apps/marketing/src/pages/download.astro:190-230`; `apps/marketing/src/layouts/Layout.astro:1-6,59-72`; `apps/marketing/src/styles/fonts.css:1-21`.

The web error boundary offers a manual clipboard report with version, route pathname, time, error/stack and bounded recursive causes. Using the pathname avoids copying query parameters, but error text itself can still be sensitive. This is not an automatic crash upload. **Fix:** redact and preview the report before copying/sharing.

The marketing download page automatically fetches GitHub release metadata from `https://api.github.com/repos/pingdotgg/t3code/releases/latest` or the releases list with `per_page=10`, including when changing release channels. It caches metadata in sessionStorage and links to release assets. GitHub observes an ordinary browser request; no prompt/code is included. Fonts/images in the reviewed marketing layout are bundled locally; no first-party browser tracking SDK was identified. **Fix:** cache/proxy release metadata server-side or disclose the direct request; retain locally bundled assets.

## 7. Developer and CI privacy boundaries

These do not mean an installed user's conversations are sent to the corresponding services.

| Path                              | What leaves, trigger, evidence                                                                                                                                                                                                                                                                                                          | Concern and fix                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub → Cursor webhook           | Workflow triggers on selected push/PR/issue/discussion events and POSTs the entire GitHub event JSON to a secret-configured Cursor URL with authentication. `.github/workflows/cursor-hygiene-webhook.yml:3-36`.                                                                                                                        | Contributor names, repository metadata, issue/PR/discussion content in the event can be forwarded. Minimize fields, disclose the automation, and define recipient retention.                                                                                       |
| Expo/EAS                          | Mobile preview/production workflows use Expo credentials, environment pull, build/update/deploy/fingerprint operations. `.github/workflows/mobile-eas-preview.yml:25-35,65-81`; `.github/workflows/mobile-eas-production.yml:86-95,136-152,216-273`.                                                                                    | Functional source/build/config transfer to Expo/EAS, separate from end-user telemetry. Audit build inclusion/exclusions, secret handling, access and retention. External CLI analytics payloads are not established here.                                          |
| Public client Axiom configuration | Relay tracing configuration is serialized for builds and local environment setup; release CI stores a tracing config artifact for one day, downloads it, masks the token, and supplies the values to builds/Vercel. `infra/relay/scripts/deploy.ts:104-112,172-176,213-218`; `.github/workflows/release.yml:279-294,506-518,1047-1054`. | This is how direct client tracing can become enabled without a user's local server configuration. Ingest tokens are intentionally public/dataset-scoped, not administrative secrets. Limit write capabilities, rotate, rate-limit abuse, and add end-user consent. |
| Astro CLI dependency              | Marketing scripts invoke Astro; lockfile includes `@astrojs/telemetry@3.3.2` transitively. `apps/marketing/package.json:6-15`; `pnpm-lock.yaml:1156-1158,15950-15952`.                                                                                                                                                                  | A developer/build telemetry dependency, **not proof of a marketing-page browser tracker**. Exact dependency payload/destination/defaults were not audited. Pin/audit the dependency and configure its documented telemetry opt-out in developer/CI environments.   |
| Alchemy deployment tooling        | Deployment wrapper provides `TelemetryLive`; relay CI sets `ALCHEMY_TELEMETRY_DISABLED=1`. `infra/relay/scripts/deploy.ts:262-269`; `.github/workflows/deploy-relay.yml:24-37`.                                                                                                                                                         | CI's opt-out is not evidence that a maintainer's local deployment is opted out. Set the documented disable variable for local runs as well; audit the pinned tooling implementation separately.                                                                    |

No first-party Sentry, Mixpanel, Bugsnag, Datadog, Firebase/Crashlytics, Google Analytics/Tag Manager, Cloudflare Web Analytics beacon, Vercel Analytics, `sendBeacon`, or Electron `crashReporter.start` integration was identified by the signature search across application/shared/infra/scripts/native/workflow sources. This is a bounded negative result, not certification of dependencies or hosting-dashboard injection. PostHog here is implemented with a direct HTTP client, illustrating why dependency-only scans are insufficient.

## 8. Practical controls and remediation priorities

### Reduce disclosure without changing source

1. **Stop PostHog product events:** start every applicable server with `T3CODE_TELEMETRY_ENABLED=false`; restart existing processes. This does not stop the identity-file initialization described above.
2. **Stop optional environment/desktop OTLP:** remove trace/metric collector URLs from environment variables, saved settings, and desktop bootstrap configuration; restart. Local traces remain independent.
3. **Address direct client Axiom separately:** custom builds must omit relay tracing URL/dataset/token configuration; mobile uses `EXPO_PUBLIC_OTLP_TRACES_*`, web uses `VITE_RELAY_OTLP_TRACES_*`. No universal runtime end-user off switch was identified.
4. **Avoid cloud content sync when unnecessary:** disable agent activity publishing and notifications, unlink unused environments/devices, or avoid hosted Connect. This is separate from disabling product analytics.
5. **Review provider and capture inputs:** do not upload feedback logs or attach private screenshots/browser captures without reviewing them. Provider-specific privacy controls still apply.
6. **Protect retained data:** treat T3 state, provider logs, terminal logs, screenshots/recordings, preview cookies, auth credentials, and their backups as sensitive. Use restrictive OS access and disk encryption; delete through supported controls rather than deleting a live database.
7. **Control auxiliary checks:** desktop exposes `T3CODE_DISABLE_AUTO_UPDATE` (`apps/desktop/src/app/DesktopConfig.ts:51-53`); model-manifest network refresh follows `enableProviderUpdateChecks`. If checks are disabled, maintain a manual security-update process.

There is no evidence here that one existing “disable telemetry” control disables all telemetry and privacy-relevant network traffic.

### Source changes worth prioritizing

| Priority | Change                                                                                                                                     | Why                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| High     | Default-off, explicit consent for PostHog and direct client/relay diagnostics; clearly separate local diagnostics from external reporting. | Current collection is default-on or build-configured rather than consistently user-selected.                              |
| High     | Check the analytics off switch before identity resolution; replace provider-account hashing with a resettable random ID.                   | Stops unnecessary account-file access and cross-installation account correlation.                                         |
| High     | Central redaction/allowlists for trace attributes, URLs, errors, and provider logs; no rejected raw trace-body logging.                    | Diagnostic paths carry richer data than the constrained product-event schema.                                             |
| High     | Explicit log-upload consent and status-only cloud activity/notification options.                                                           | Feedback logs and human-readable project/thread metadata can disclose work content.                                       |
| Medium   | Expiry/purge for auth metadata, pairing records, stale cloud activity, delivery attempts, captures, and terminal history.                  | Hiding expired entries or rotating files is not a complete retention policy.                                              |
| Medium   | Minimal provider subprocess environment and ephemeral agent browser sessions by default.                                                   | Reduces unnecessary exposure of unrelated credentials and authenticated browsing state.                                   |
| Medium   | Document operator/subprocessor boundaries and minimize CI webhook data.                                                                    | Users and contributors need to distinguish T3, AI providers, Axiom/PostHog, Clerk, Cloudflare, Apple, and build services. |

These are recommendations only. This audit does not modify runtime behavior or silently disable any feature.

## Verification and limitations

- Traced first-party analytics producers through payload construction and transport; the product inventory contains 15 distinct event names.
- Separately traced local IPC, local file sinks, optional collectors, directly configured client collectors, relay infrastructure, and functional third-party paths.
- Searched application/shared/infra/native/workflow sources for common analytics/crash SDK signatures and reviewed relevant dependency/configuration evidence.
- Checked source-reference file existence and line bounds programmatically, and directly inspected the major identity, consent, payload, export, feedback, relay-account, and retention boundaries.
- No runtime traffic capture, provider subprocess launch, external upload, browser interaction, or production configuration verification was performed. No app tests were needed for this document-only change.
- A future release, injected hosting script, provider/plugin/MCP tool, native OS service, or changed dependency can add traffic outside this snapshot. Re-audit outgoing transports and payloads after updates; do not infer guarantees about future versions from this report.
