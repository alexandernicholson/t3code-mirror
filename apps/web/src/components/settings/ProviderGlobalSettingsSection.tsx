import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import type {
  EnvironmentId,
  ProviderGlobalSettings,
  ProviderGlobalSettingsWriteInput,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  globalSettingAtPath,
  globalSettingSource,
  globalSettingsDraft,
  globalSettingsEdits,
  parseGlobalSettingJson,
} from "@t3tools/client-runtime/provider-global-settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type Props = {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly readOnly: boolean;
};

export function ProviderGlobalSettingsSection(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title="Global settings">
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-1">
            Configuration file
            <InfoTooltip label="About global settings">
              Edit the provider's settings on this environment. Instances that share this file share
              its settings. Thread settings and launch arguments can override them. Reset removes a
              setting from the file so Codex can use its default or inherited value.
            </InfoTooltip>
          </span>
        }
        control={
          <Button
            variant="outline"
            size="sm"
            aria-label={open ? "Close global settings" : "Edit global settings"}
            disabled={props.readOnly}
            onClick={() => setOpen(!open)}
          >
            {open ? "Close" : "Edit"}
          </Button>
        }
      />
      {props.readOnly ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          You need editing access to view these settings.
        </p>
      ) : open ? (
        <GlobalSettingsEditor {...props} />
      ) : null}
    </SettingsSection>
  );
}

function GlobalSettingsEditor({ environmentId, instanceId }: Props) {
  const read = useAtomCommand(serverEnvironment.readProviderGlobalSettings, {
    reportFailure: false,
  });
  const write = useAtomCommand(serverEnvironment.writeProviderGlobalSettings, {
    reportFailure: false,
  });
  const [settings, setSettings] = useState<ProviderGlobalSettings | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void read({ environmentId, input: { instanceId } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setSettings(result.value);
      else setError(errorMessage(squashAtomCommandFailure(result)));
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, instanceId, read]);

  async function reload() {
    if (pending || busy.current) return;
    setPending(true);
    setError(null);
    setSaved(false);
    setSettings(null);
    const result = await read({ environmentId, input: { instanceId } });
    if (result._tag === "Success") setSettings(result.value);
    else setError(errorMessage(squashAtomCommandFailure(result)));
    setPending(false);
  }

  async function save(edits: ProviderGlobalSettingsWriteInput["edits"]) {
    if (!settings || pending || busy.current || edits.length === 0) return;
    busy.current = true;
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await write({
        environmentId,
        input: {
          instanceId,
          filePath: settings.filePath,
          expectedVersion: settings.version,
          edits,
        },
      });
      if (result._tag === "Success") {
        setSettings(result.value);
        setSaved(true);
      } else setError(errorMessage(squashAtomCommandFailure(result)));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 px-3 pb-4 sm:px-4" aria-busy={pending}>
      {settings ? (
        <>
          <p className="break-all font-mono text-xs text-muted-foreground">{settings.filePath}</p>
          <p className="text-xs text-muted-foreground">Applies to new sessions.</p>
        </>
      ) : pending ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : null}
      {error ? (
        <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void reload()}>
        Reload
      </Button>
      {settings ? (
        <GlobalSettingsForm
          key={settings.filePath}
          settings={settings}
          pending={pending}
          onSave={save}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not read or save provider settings.";
}

function GlobalSettingsForm({
  settings,
  pending,
  onSave,
  onError,
}: {
  readonly settings: ProviderGlobalSettings;
  readonly pending: boolean;
  readonly onSave: (edits: ProviderGlobalSettingsWriteInput["edits"]) => Promise<void>;
  readonly onError: (error: string | null) => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => globalSettingsDraft(settings));
  const [advancedKey, setAdvancedKey] = useState("");
  const [advancedValue, setAdvancedValue] = useState("");
  const [previousSettings, setPreviousSettings] = useState(settings);
  if (previousSettings !== settings) {
    setPreviousSettings(settings);
    setDraft(globalSettingsDraft(settings));
    const value = globalSettingAtPath(settings.userConfig, advancedKey);
    setAdvancedValue(value === undefined ? "" : JSON.stringify(value, null, 2));
  }
  const dirty = settings.fields.some(
    (field) => draft[field.key] !== (field.value === null ? "" : String(field.value)),
  );
  function chooseKey(key: string) {
    setAdvancedKey(key);
    const value = globalSettingAtPath(settings.userConfig, key);
    setAdvancedValue(value === undefined ? "" : JSON.stringify(value, null, 2));
  }
  const advancedSource = globalSettingSource(settings, advancedKey);
  return (
    <fieldset disabled={pending} className="min-w-0 space-y-2">
      {settings.fields.map((field) => (
        <SettingsRow
          key={field.key}
          title={
            <span className="inline-flex items-center gap-1">
              {field.title}
              <InfoTooltip label={`About ${field.title}`}>
                <p>{field.description}</p>
                {field.effectiveValue !== null ? (
                  <p className="mt-2 break-words">
                    Current value: {String(field.effectiveValue)}.
                    {field.overriddenBy ? ` Set by ${field.overriddenBy}.` : ""}
                  </p>
                ) : null}
              </InfoTooltip>
            </span>
          }
          description={
            field.overriddenBy && field.effectiveValue !== null
              ? `Using ${String(field.effectiveValue)} from an override.`
              : undefined
          }
          control={
            <div className="flex items-center gap-2">
              {field.control === "select" ? (
                <Select
                  disabled={pending}
                  value={draft[field.key] || "__inherit"}
                  onValueChange={(value) => {
                    if (typeof value === "string")
                      setDraft({ ...draft, [field.key]: value === "__inherit" ? "" : value });
                  }}
                >
                  <SelectTrigger className="w-44" aria-label={field.title}>
                    <SelectValue>
                      {field.options?.find((option) => option.value === draft[field.key])?.label ??
                        (draft[field.key] || "Default")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="__inherit">Default</SelectItem>
                    {field.options?.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : (
                <div className="flex w-44 items-center gap-2">
                  <Input
                    className="min-w-0"
                    aria-label={field.title}
                    inputMode={field.control === "number" ? "numeric" : "text"}
                    placeholder="Default"
                    value={draft[field.key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                  {field.control === "number" ? (
                    <span className="text-xs text-muted-foreground">tokens</span>
                  ) : null}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!draft[field.key]}
                aria-label={`Reset ${field.title}`}
                onClick={() => setDraft({ ...draft, [field.key]: "" })}
              >
                Reset
              </Button>
            </div>
          }
        />
      ))}
      <Button
        size="sm"
        disabled={!dirty}
        onClick={() => {
          try {
            void onSave(globalSettingsEdits(settings, draft));
          } catch (error) {
            onError(errorMessage(error));
          }
        }}
      >
        Save
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!dirty}
        onClick={() => setDraft(globalSettingsDraft(settings))}
      >
        Discard
      </Button>
      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1">
            {Object.keys(settings.userConfig)
              .sort()
              .map((key) => (
                <Button key={key} variant="ghost" size="sm" onClick={() => chooseKey(key)}>
                  {key}
                </Button>
              ))}
          </div>
          <div className="flex items-center gap-1">
            <Label htmlFor={`${formId}-key`}>Key</Label>
            <InfoTooltip label="About configuration keys">
              <p>Use a dotted path for nested settings, such as features.memories.</p>
              {advancedKey ? (
                <p className="mt-2 break-words">
                  Current value:{" "}
                  {JSON.stringify(globalSettingAtPath(settings.effectiveConfig, advancedKey)) ??
                    "Unset"}
                  .{advancedSource ? ` Set by ${advancedSource}.` : ""}
                </p>
              ) : null}
            </InfoTooltip>
          </div>
          <Input
            id={`${formId}-key`}
            aria-label="Configuration key"
            placeholder="e.g. features.memories"
            value={advancedKey}
            onChange={(event) => chooseKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-1">
            <Label htmlFor={`${formId}-value`}>Value (JSON)</Label>
            <InfoTooltip label="About JSON values">
              Strings need double quotes. Use arrays for lists and objects for tables. Saving an
              object replaces the whole table. Reset removes the key from this file.
            </InfoTooltip>
          </div>
          <Textarea
            id={`${formId}-value`}
            aria-label="Configuration value (JSON)"
            value={advancedValue}
            onChange={(event) => setAdvancedValue(event.target.value)}
            placeholder={'e.g. true, "value", ["item"]'}
            className="min-h-28 font-mono"
            spellCheck={false}
          />
          {dirty ? (
            <p className="text-xs text-muted-foreground">
              Save or discard your changes above first.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={dirty || !advancedKey.trim() || !advancedValue.trim()}
              onClick={() => {
                try {
                  void onSave([
                    { key: advancedKey.trim(), value: parseGlobalSettingJson(advancedValue) },
                  ]);
                } catch {
                  onError("Enter valid JSON. Put strings in double quotes.");
                }
              }}
            >
              Save key
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                dirty || globalSettingAtPath(settings.userConfig, advancedKey) === undefined
              }
              onClick={() => void onSave([{ key: advancedKey.trim(), value: null }])}
            >
              Reset key
            </Button>
          </div>
        </div>
      </details>
    </fieldset>
  );
}

function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button size="icon-micro" variant="ghost-muted" aria-label={label}>
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top" className="max-w-72">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}
