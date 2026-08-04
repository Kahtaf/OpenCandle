import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.jsx";
import { cn } from "../../lib/utils.js";

const EMPTY_KEY_MESSAGE = "Paste an API key first.";

/**
 * Two-step provider credential flow: choose a provider, then enter its key.
 *
 * It owns its own step state and knows nothing about the surface it is mounted
 * in, so a settings screen can render it directly. `onBack` is the host's
 * escape from the first step only. Step two always returns to the provider
 * list on its own.
 */
export function ProviderKeyFlow({
  providers = [],
  hosted = false,
  defaultStorageMode = "persistent",
  disabled = false,
  pendingProviderId = "",
  selectedProviderId,
  onSubmit,
  onSelectedProviderChange,
  onBack,
  backLabel = "Back",
  className,
}) {
  // Controlled when the host needs to know which step is showing. The
  // onboarding dialog does, so one footer can own every Back. Uncontrolled
  // otherwise, so a settings screen can drop this in with no state of its own.
  const [internalId, setInternalId] = useState("");
  const controlled = selectedProviderId !== undefined;
  const selectedId = controlled ? selectedProviderId : internalId;
  const selected = providers.find((provider) => provider.id === selectedId);

  const select = (nextId) => {
    if (!controlled) setInternalId(nextId);
    onSelectedProviderChange?.(nextId);
  };

  if (!selected) {
    return (
      <ProviderList
        className={className}
        providers={providers}
        hosted={hosted}
        disabled={disabled}
        onSelect={(provider) => select(provider.id)}
        onBack={onBack}
        backLabel={backLabel}
      />
    );
  }

  return (
    <ProviderKeyForm
      className={className}
      provider={selected}
      hosted={hosted}
      defaultStorageMode={defaultStorageMode}
      disabled={disabled}
      pending={pendingProviderId === selected.id}
      onSubmit={onSubmit}
      // A host that controls the selection also owns the back affordance, so
      // the onboarding dialog can keep exactly one Back in its footer instead
      // of one there and a second inside the form. Uncontrolled hosts keep the
      // form's own control and need no wiring.
      onBack={controlled ? undefined : () => select("")}
    />
  );
}

export function ProviderList({
  providers = [],
  hosted = false,
  disabled = false,
  onSelect,
  onBack,
  backLabel = "Back",
  className,
}) {
  return (
    <div data-slot="provider-list" className={cn("grid gap-3", className)}>
      {/* One bordered group with hairline dividers, never a card inside a card.
          Choosing a provider gates the whole product, so this group carries the
          strong hairline and each row ends in an Ink affordance: it should be
          the heaviest thing on the step, not three quiet grey rows. */}
      <div className="overflow-hidden rounded-lg border border-hard">
        {providers.length === 0 ? (
          // `requirement: "unknown"` arrives with no providers at all, before
          // the server has reported which are supported. Say so rather than
          // rendering an empty box under a heading that promises a key field.
          <p
            data-slot="provider-list-empty"
            className="m-0 px-3 py-4 text-sm leading-relaxed text-muted-foreground"
          >
            OpenCandle has not reported which model providers are available yet. Refresh to try
            again.
          </p>
        ) : null}
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            data-slot="provider-option"
            disabled={disabled}
            onClick={() => onSelect?.(provider)}
            className="group flex min-h-14 w-full items-center gap-3 border-b border-border bg-card px-4 py-3 text-left transition-colors duration-150 ease-out last:border-b-0 hover:bg-secondary active:bg-tertiary focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-[15px] font-semibold leading-5 tracking-tight text-foreground">
                {provider.label}
              </span>
              {/* Plain language, no env-var identifiers: this is the first
                  screen a new user sees. The default model is the one fact that
                  actually helps them choose. */}
              <span className="truncate text-xs leading-5 text-muted-foreground">
                Runs <span className="tabular-nums">{provider.defaultModel}</span>
                {hosted ? " through the audited relay" : " by default"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-foreground">
              Add key
              <ChevronRight
                className="h-4 w-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                aria-hidden="true"
                strokeWidth={2}
              />
            </span>
          </button>
        ))}
      </div>
      {onBack ? (
        <div className="flex">
          <Button
            type="button"
            variant="bordered"
            size="sm"
            prefixIcon={ChevronLeft}
            onClick={onBack}
          >
            {backLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProviderKeyForm({
  provider,
  hosted = false,
  defaultStorageMode = "persistent",
  disabled = false,
  pending = false,
  onSubmit,
  onBack,
  className,
}) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const storageId = useId();
  const [apiKey, setApiKey] = useState("");
  const [storageMode, setStorageMode] = useState(defaultStorageMode || "persistent");
  const [fieldError, setFieldError] = useState("");

  const submit = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setFieldError(EMPTY_KEY_MESSAGE);
      return;
    }
    setFieldError("");
    onSubmit?.({
      provider: provider.id,
      apiKey: trimmed,
      storageMode: hosted ? storageMode : undefined,
    });
    setApiKey("");
  };

  return (
    <div data-slot="provider-key-form" className={cn("grid gap-3", className)}>
      <div>
        <h3 className="m-0 mb-0.5 text-[15px] font-semibold leading-5 tracking-tight text-foreground">
          {provider.label}
        </h3>
        {/* The environment variable belongs here, on the screen where pasting a
            key is the task, and written as something the user set rather than
            as a bare identifier on the first screen of onboarding. */}
        <p className="m-0 text-xs leading-5 text-muted-foreground">
          Runs <span className="tabular-nums">{provider.defaultModel}</span>
          {hosted ? (
            " through the audited relay. Pi runs in this browser."
          ) : (
            <>
              <span> by default. Also reads </span>
              <code>{provider.envVar}</code>
              <span> from your shell.</span>
            </>
          )}
        </p>
      </div>
      {hosted ? (
        // Zinc Mist band rather than a bordered box nested in the panel.
        <fieldset className="grid gap-1 rounded-md bg-secondary p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Keep this key</legend>
          <RadioGroup
            name={`${storageId}-storage`}
            value={storageMode}
            onValueChange={setStorageMode}
            disabled={disabled}
          >
            <StorageChoice
              id={`${storageId}-persistent`}
              value="persistent"
              title="Keep on this device"
              detail="Kept after you close and reopen the app."
            />
            <StorageChoice
              id={`${storageId}-session`}
              value="session"
              title="Only for this browser session"
              detail="Cleared when the last OpenCandle tab closes."
            />
          </RadioGroup>
        </fieldset>
      ) : null}
      <label className="grid gap-1.5" htmlFor={fieldId}>
        <span className="text-xs font-medium text-muted-foreground">{provider.label} API key</span>
        <Input
          data-slot="provider-key-input"
          id={fieldId}
          type="password"
          name={`${provider.id}-api-key`}
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            if (fieldError) setFieldError("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
          autoComplete="off"
          placeholder={`${provider.label} API key`}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={fieldError ? "true" : undefined}
          aria-describedby={fieldError ? errorId : undefined}
        />
      </label>
      {fieldError ? (
        <p
          data-slot="provider-key-error"
          id={errorId}
          role="alert"
          className="m-0 text-xs leading-relaxed text-destructive"
        >
          {fieldError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-slot="provider-key-save"
          variant="brand"
          size="sm"
          onClick={submit}
          disabled={disabled || pending}
          aria-busy={pending ? "true" : undefined}
        >
          {pending ? "Saving…" : "Save key"}
        </Button>
        <Button asChild variant="bordered" size="sm" suffixIcon={ExternalLink}>
          <a href={provider.signupUrl} target="_blank" rel="noreferrer">
            Get key
          </a>
        </Button>
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            prefixIcon={ChevronLeft}
            onClick={onBack}
          >
            Back
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StorageChoice({ id, value, title, detail }) {
  return (
    <div className="flex min-h-10 items-start gap-3 py-1">
      <RadioGroupItem id={id} value={value} className="mt-1" />
      <label htmlFor={id} className="grid cursor-pointer gap-0.5 text-sm text-foreground">
        <span className="font-medium">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>
      </label>
    </div>
  );
}
