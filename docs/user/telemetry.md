# Product usage data

This fork does not send product usage data by default and has no built-in PostHog
destination or project key. Disabled analytics does not read provider account files
or create a tracking identifier.

If you operate your own analytics service, explicitly set all three server variables:
`T3CODE_TELEMETRY_ENABLED=true`, `T3CODE_POSTHOG_HOST`, and `T3CODE_POSTHOG_KEY`.
Enabled events use a random installation identifier and can include provider, model,
reasoning effort, permission mode, turn result, duration, and main-agent token totals.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To keep collection disabled, leave it unconfigured or set
`T3CODE_TELEMETRY_ENABLED=false` before starting the server.

Direct relay-client Axiom export has been removed. Local diagnostics and explicitly
configured server/desktop OTLP collectors are separate from product analytics.
Cloud features require `T3CODE_CLOUD_ENABLED=true` and your own service configuration;
existing keys or saved cloud credentials alone do not enable them. AI-provider
requests and direct, SSH, or Tailscale connections remain available.
