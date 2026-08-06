import {
  ArrowRight,
  ChevronLeft,
  Clipboard,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Kbd } from "../../components/ui/kbd.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import { cn } from "../../lib/utils.js";
import { FieldRenderer } from "./field-renderer.jsx";
import { defaultValuesFor, validateRequired } from "./field-utils.js";
import { coerceFieldValue, fieldsForTool } from "./schema-form.js";
import { DOMAIN_LABELS } from "./tool-form-overrides.js";
import { schemaForWorkflow } from "./workflow-schemas.js";

const TABS = [
  { id: "workflows", label: "Workflows", icon: Sparkles },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "providers", label: "Providers", icon: KeyRound },
];

const INITIAL_TAB = "workflows";

export function CatalogOverlay({
  open,
  initialTab,
  initialProviderId,
  catalog,
  onClose,
  send,
  setToast,
  startChatRun,
  invokeTool,
  fillComposer,
  sessionId,
}) {
  const activeInitialTab = initialTab ?? INITIAL_TAB;
  const initialSelection = initialProviderId ? { kind: "provider", id: initialProviderId } : null;
  const openStateKey = open ? `open:${activeInitialTab}:${initialProviderId || ""}` : "closed";
  const [lastOpenStateKey, setLastOpenStateKey] = useState(openStateKey);
  const [tab, setTab] = useState(activeInitialTab);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(initialSelection); // { kind: 'tool'|'workflow'|'provider', id }
  // Body container ref so we can rewind scrollTop when the user pushes/pops
  // between list and builder views — otherwise a list scroll position carries
  // over and hides the builder header on mobile.
  const bodyRef = useRef(null);

  if (lastOpenStateKey !== openStateKey) {
    setLastOpenStateKey(openStateKey);
    if (open) {
      setTab(activeInitialTab);
      setQuery("");
      setSelection(initialSelection);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling must reset exactly when the active catalog view changes.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [selection, tab]);

  const close = useCallback(() => {
    setSelection(null);
    setQuery("");
    onClose();
  }, [onClose]);

  // Symbol typeahead requires a dedicated server endpoint (not yet implemented).
  // Returning undefined keeps SymbolInput in plain uppercase-input mode.
  const lookupSymbol = undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent
        width="xl"
        handleLabel="Catalog"
        className="!h-[min(34rem,calc(100dvh-2rem))] p-0 md:!h-[min(34rem,calc(100dvh-2rem))]"
      >
        {selection ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
            <BuilderHeader
              selection={selection}
              catalog={catalog}
              onBack={() => setSelection(null)}
            />
            <div ref={bodyRef} className="min-h-0 overflow-y-auto overscroll-contain">
              <BuilderBody
                selection={selection}
                catalog={catalog}
                send={send}
                setToast={setToast}
                startChatRun={startChatRun}
                invokeTool={invokeTool}
                fillComposer={fillComposer}
                onClose={close}
                lookupSymbol={lookupSymbol}
                sessionId={sessionId}
              />
            </div>
          </div>
        ) : (
          <CatalogList
            tab={tab}
            setTab={setTab}
            query={query}
            setQuery={setQuery}
            catalog={catalog}
            onSelect={(next) => setSelection(next)}
            bodyRef={bodyRef}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function ListHeader({ tab, setTab, query, setQuery, counts }) {
  return (
    <div className="border-b border-border">
      <div className="px-3 pt-2 sm:px-4">
        <div className="flex min-h-12 w-full items-center gap-0.5 rounded-md bg-secondary p-1">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const selected = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-[background-color,color,box-shadow,transform,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-card text-foreground shadow-subtle-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" />
                <span className="truncate">{entry.label}</span>
                <span
                  className={cn(
                    "hidden rounded-full px-1.5 text-[10px] tabular-nums sm:inline",
                    selected ? "bg-secondary text-muted-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {counts[entry.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={searchPlaceholder(tab)}
          autoFocus
          className="h-8 pr-8 text-sm"
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function searchPlaceholder(tab) {
  if (tab === "workflows") return "Search workflows";
  if (tab === "providers") return "Search providers";
  return "Search tools by name, label, or domain";
}

export function CatalogList({
  tab,
  setTab = () => {},
  query,
  setQuery = () => {},
  catalog,
  onSelect,
  bodyRef,
}) {
  return (
    <Command shouldFilter={false} className="h-full min-h-0 flex-1 rounded-none">
      <ListHeader
        tab={tab}
        setTab={setTab}
        query={query}
        setQuery={setQuery}
        counts={{
          workflows: catalog?.workflows?.length ?? 0,
          tools: catalog?.tools?.length ?? 0,
          providers: catalog?.providers?.length ?? 0,
        }}
      />
      <CommandList ref={bodyRef} className="min-h-0 !max-h-none flex-1 overscroll-contain">
        <ListBody tab={tab} query={query} catalog={catalog} onSelect={onSelect} />
      </CommandList>
      <fieldset
        className="flex min-h-10 shrink-0 items-center justify-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground"
        aria-label="Catalog keyboard shortcuts"
      >
        <Kbd>↑↓</Kbd>
        <span>navigate</span>
        <span aria-hidden="true">·</span>
        <Kbd>↵</Kbd>
        <span>run</span>
        <span aria-hidden="true">·</span>
        <Kbd>esc</Kbd>
      </fieldset>
    </Command>
  );
}

function ListBody({ tab, query, catalog, onSelect }) {
  if (tab === "workflows") {
    const workflows = filterWorkflows(catalog?.workflows ?? [], query);
    if (workflows.length === 0) {
      return (
        <CommandEmpty>
          <EmptyState query={query} kind="workflows" />
        </CommandEmpty>
      );
    }
    return (
      <div className="grid divide-y divide-border">
        {workflows.map((workflow) => (
          <WorkflowRow key={workflow.id} workflow={workflow} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  if (tab === "providers") {
    const providers = filterProviders(catalog?.providers ?? [], query);
    if (providers.length === 0) {
      return (
        <CommandEmpty>
          <EmptyState query={query} kind="providers" />
        </CommandEmpty>
      );
    }
    return (
      <div className="grid divide-y divide-border">
        {providers.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const tools = filterTools(catalog?.tools ?? [], query);
  if (tools.length === 0) {
    return (
      <CommandEmpty>
        <EmptyState query={query} kind="tools" />
      </CommandEmpty>
    );
  }
  const grouped = groupBy(tools, (tool) => tool.domain ?? "tool");
  const order = [
    "market",
    "fundamentals",
    "options",
    "portfolio",
    "technical",
    "sentiment",
    "macro",
    "interaction",
  ];
  const sortedDomains = [...grouped.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return (
    <div className="grid">
      {sortedDomains.map((domain, index) => (
        <CommandGroup
          key={domain}
          heading={DOMAIN_LABELS[domain] ?? domain}
          className={cn(
            "divide-y divide-border border-y border-border p-0 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]",
            index === 0 ? "" : "mt-2",
          )}
        >
          {grouped.get(domain).map((tool) => (
            <ToolRow key={tool.name} tool={tool} onSelect={onSelect} />
          ))}
        </CommandGroup>
      ))}
    </div>
  );
}

function WorkflowRow({ workflow, onSelect }) {
  return (
    <CommandItem
      value={`workflow:${workflow.id}`}
      onSelect={() => onSelect({ kind: "workflow", id: workflow.id })}
      className="group w-full items-start gap-3 rounded-none px-4 py-3 text-left hover:bg-secondary"
    >
      <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{workflow.name}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{workflow.description}</p>
      </div>
      <ArrowRight
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </CommandItem>
  );
}

function ToolRow({ tool, onSelect }) {
  const disabled = tool.enabled === false;
  return (
    <CommandItem
      value={`tool:${tool.name}`}
      onSelect={() => onSelect({ kind: "tool", id: tool.name })}
      className={cn(
        "group w-full items-start gap-3 rounded-none px-4 py-2.5 text-left hover:bg-secondary",
        disabled && "opacity-60",
      )}
    >
      <Wrench aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {tool.label || prettyToolName(tool.name)}
          </span>
          <code className="hidden truncate text-[11px] tabular-nums text-muted-foreground/70 sm:inline">
            {tool.name}
          </code>
          {disabled ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              disabled
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{tool.description}</p>
      </div>
      <ArrowRight
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </CommandItem>
  );
}

function ProviderRow({ provider, onSelect }) {
  const status = providerStatus(provider);
  const Icon = providerIcon(provider);
  return (
    <CommandItem
      value={`provider:${provider.id}`}
      onSelect={() => onSelect({ kind: "provider", id: provider.id })}
      className="group w-full items-start gap-3 rounded-none px-4 py-3 text-left hover:bg-secondary"
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{provider.displayName}</span>
          <ProviderStatusDot status={status} />
          <span className={cn("text-[11px]", statusColor(status))}>{statusLabel(status)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {(provider.unlocks || []).join(" · ")}
        </p>
      </div>
      <ArrowRight
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </CommandItem>
  );
}

function EmptyState({ query, kind }) {
  return (
    <div className="grid gap-2 p-12 text-center">
      <Search className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        {query ? `No ${kind} match "${query}"` : `No ${kind} available`}
      </p>
      <p className="mx-auto max-w-xs text-xs text-muted-foreground">
        {query
          ? "Try a shorter query or check spelling."
          : "OpenCandle did not return entries for this section."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail / builder view
// ---------------------------------------------------------------------------

function BuilderHeader({ selection, catalog, onBack }) {
  const entity = resolveSelection(selection, catalog);
  const ProviderIcon = selection.kind === "provider" && entity ? providerIcon(entity) : KeyRound;
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
      <Button variant="ghost" size="icon-sm" aria-label="Back to catalog" onClick={onBack}>
        <ChevronLeft />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {selection.kind === "workflow" ? (
          <Sparkles className="h-4 w-4 text-foreground" aria-hidden="true" />
        ) : null}
        {selection.kind === "tool" ? (
          <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : null}
        {selection.kind === "provider" ? (
          <ProviderIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <h2 className="truncate text-sm font-semibold text-foreground">
          {builderTitle(selection, entity)}
        </h2>
        {selection.kind === "tool" && entity?.domain ? (
          <Badge variant="outline" className="hidden h-5 px-1.5 text-[10px] sm:inline-flex">
            {DOMAIN_LABELS[entity.domain] ?? entity.domain}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function BuilderBody({
  selection,
  catalog,
  send,
  setToast,
  startChatRun,
  invokeTool,
  fillComposer,
  onClose,
  lookupSymbol,
  sessionId,
}) {
  const entity = resolveSelection(selection, catalog);
  if (!entity) {
    const catalogIsStillLoading = !catalogHasEntries(catalog);
    return (
      <div className="grid gap-2 p-12 text-center">
        <p className="text-sm font-medium text-foreground">
          {catalogIsStillLoading ? "Loading catalog…" : "Selection no longer available"}
        </p>
        <p className="text-xs text-muted-foreground">
          {catalogIsStillLoading
            ? "Preparing the selected entry."
            : "The catalog refreshed while you were viewing this entry."}
        </p>
      </div>
    );
  }
  if (selection.kind === "workflow") {
    return (
      <WorkflowBuilder
        workflow={entity}
        startChatRun={startChatRun}
        fillComposer={fillComposer}
        onClose={onClose}
        setToast={setToast}
        lookupSymbol={lookupSymbol}
        sessionId={sessionId}
      />
    );
  }
  if (selection.kind === "tool") {
    return (
      <ToolBuilder
        tool={entity}
        startChatRun={startChatRun}
        invokeTool={invokeTool}
        fillComposer={fillComposer}
        onClose={onClose}
        setToast={setToast}
        lookupSymbol={lookupSymbol}
      />
    );
  }
  return <ProviderBuilder provider={entity} send={send} setToast={setToast} />;
}

function catalogHasEntries(catalog) {
  return [catalog?.workflows, catalog?.tools, catalog?.providers].some(
    (entries) => Array.isArray(entries) && entries.length > 0,
  );
}

function WorkflowBuilder({
  workflow,
  startChatRun,
  fillComposer,
  onClose,
  setToast,
  lookupSymbol,
}) {
  const schema = schemaForWorkflow(workflow.id);
  const fields = schema?.fields ?? [];
  const [values, setValues] = useState(() => defaultValuesFor(fields));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const setField = useCallback(
    (name, value) => setValues((prev) => ({ ...prev, [name]: value })),
    [],
  );
  const issues = validateRequired(fields, values);
  const prompt = useMemo(
    () => (schema ? safeBuildPrompt(schema, values) : workflow.prompt || workflow.name),
    [schema, values, workflow],
  );
  const baseFields = fields.filter((f) => !f.advanced);
  const advancedFields = fields.filter((f) => f.advanced);

  if (!schema) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          No builder defined for "{workflow.name}". The agent will use its default planner.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="brand"
            onClick={() => {
              void startChatRun(workflow.prompt || workflow.name);
              onClose();
            }}
          >
            Run with defaults
          </Button>
        </div>
      </div>
    );
  }

  const submit = (mode) => {
    if (issues.length > 0) {
      setToast?.(issues[0]);
      return;
    }
    if (mode === "send") {
      void startChatRun(prompt);
      onClose();
      return;
    }
    fillComposer?.(prompt);
    setToast?.("Draft loaded — edit and send when ready.");
    onClose();
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <p className="text-sm leading-5 text-muted-foreground">{schema.description}</p>
      <div className="grid gap-3.5">
        {baseFields.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={setField}
            lookupSymbol={lookupSymbol}
          />
        ))}
      </div>
      {advancedFields.length > 0 ? (
        <div className="grid gap-3.5 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-md px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{showAdvanced ? "Hide" : "Show"} advanced</span>
            <ArrowRight
              aria-hidden="true"
              className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-90")}
            />
          </button>
          {showAdvanced
            ? advancedFields.map((field) => (
                <FieldRenderer
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  onChange={setField}
                  lookupSymbol={lookupSymbol}
                />
              ))
            : null}
        </div>
      ) : null}
      <PromptPreview prompt={prompt} />
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="bordered" onClick={() => submit("draft")} disabled={!prompt}>
          Edit in chat
        </Button>
        <Button variant="brand" onClick={() => submit("send")} disabled={!prompt} prefixIcon={Play}>
          Run workflow
        </Button>
      </div>
    </div>
  );
}

export function buildCatalogToolInvokePayload(toolName, args, sessionId = "") {
  return {
    toolName,
    args,
    ...(sessionId ? { sessionId } : {}),
  };
}

function ToolBuilder({
  tool,
  startChatRun,
  invokeTool,
  fillComposer,
  onClose,
  setToast,
  lookupSymbol,
  sessionId,
}) {
  const schema = useMemo(() => fieldsForTool(tool), [tool]);
  const [values, setValues] = useState(() => defaultValuesFor(schema));
  const [running, setRunning] = useState(false);
  const setField = useCallback(
    (name, value) => setValues((prev) => ({ ...prev, [name]: value })),
    [],
  );
  const issues = validateRequired(schema, values);

  const cleanArgs = useMemo(() => stripEmpty(coerceValues(schema, values)), [schema, values]);
  const promptText = useMemo(
    () => `Use ${tool.name}${formatArgsForPrompt(cleanArgs)}`,
    [tool, cleanArgs],
  );

  const submit = async (mode) => {
    if (issues.length > 0) {
      setToast?.(issues[0]);
      return;
    }
    if (mode === "send") {
      void startChatRun(promptText);
      onClose();
      return;
    }
    if (mode === "draft") {
      fillComposer?.(promptText);
      setToast?.("Draft loaded — edit and send when ready.");
      onClose();
      return;
    }
    if (mode === "run") {
      if (!invokeTool) {
        setToast?.("This tool cannot run until the GUI connection is ready.");
        return;
      }
      setRunning(true);
      try {
        await invokeTool(tool.name, cleanArgs, sessionId);
        setToast?.(`${tool.label || tool.name} completed.`);
        onClose();
      } catch (error) {
        setToast?.(error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
      }
    }
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <p className="text-sm leading-5 text-muted-foreground">{tool.description}</p>
      {schema.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
          This tool takes no inputs.
        </div>
      ) : (
        <div className="grid gap-3.5">
          {schema.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={setField}
              lookupSymbol={lookupSymbol}
            />
          ))}
        </div>
      )}
      <PromptPreview prompt={promptText} title="Chat preview" />
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="bordered" size="sm" onClick={() => submit("draft")}>
          Edit in chat
        </Button>
        <Button
          variant="brand"
          size="sm"
          prefixIcon={Play}
          disabled={running}
          onClick={() => void submit("run")}
        >
          {running ? "Running…" : "Run now"}
        </Button>
      </div>
    </div>
  );
}

function ProviderBuilder({ provider, send, setToast }) {
  if (provider.kind === "external-tool") {
    return <ExternalToolProviderBuilder provider={provider} send={send} setToast={setToast} />;
  }
  if (provider.kind === "public-http") {
    return <PublicHttpProviderBuilder provider={provider} send={send} setToast={setToast} />;
  }
  return <ApiKeyProviderBuilder provider={provider} send={send} setToast={setToast} />;
}

function ApiKeyProviderBuilder({ provider, send, setToast }) {
  const providerStateKey = `${provider.id}:${provider.status || ""}`;
  const [lastProviderStateKey, setLastProviderStateKey] = useState(providerStateKey);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const status = providerStatus(provider);
  const envBlocked = status === "env";
  const trimmed = apiKey.trim();
  const canSave = !envBlocked && trimmed.length > 0;

  if (lastProviderStateKey !== providerStateKey) {
    setLastProviderStateKey(providerStateKey);
    setApiKey("");
    setShowApiKey(false);
  }

  const save = () => {
    if (envBlocked) {
      setToast?.(
        `${provider.displayName} is set via ${provider.envVar}. Unset it to override here.`,
      );
      return;
    }
    if (!trimmed) return;
    setToast?.(`Verifying ${provider.displayName} key…`);
    if (send?.("provider.save_api_key", { providerId: provider.id, apiKey: trimmed })) {
      setApiKey("");
    }
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <ProviderStatusDot status={status} />
          <span className={cn("text-xs font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
          {envBlocked ? (
            <code className="text-[11px] text-muted-foreground">env: {provider.envVar}</code>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {provider.fallbackDescription ? (
            <>If absent: {provider.fallbackDescription}.</>
          ) : (
            <>Required for: {(provider.unlocks || []).join(", ") || "this provider's tools"}.</>
          )}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Unlocks
        </span>
        <ul className="grid gap-1">
          {(provider.unlocks || []).map((entry) => (
            <li key={entry} className="flex items-baseline gap-2 text-sm text-foreground">
              <span aria-hidden="true" className="mt-1 h-1 w-1 rounded-full bg-foreground/40" />
              <span>{entry}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-2">
        <label
          htmlFor={`provider-api-key-${provider.id}`}
          className="text-xs font-medium text-foreground"
        >
          API key
        </label>
        <div className="relative">
          <Input
            id={`provider-api-key-${provider.id}`}
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={`Paste your ${provider.displayName} key`}
            disabled={envBlocked}
            className="pr-10 font-mono"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSave) {
                event.preventDefault();
                save();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
            tooltip={showApiKey ? "Hide API key" : "Show API key"}
            onClick={() => setShowApiKey((showing) => !showing)}
            disabled={!apiKey}
          >
            {showApiKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {envBlocked
            ? `Currently set via ${provider.envVar}. Unset that variable to manage the key here.`
            : status === "file"
              ? `${provider.hosted ? "Saved only in this browser" : "Saved to ~/.opencandle/config.json"}${provider.maskedKeyHint ? ` (${provider.maskedKeyHint})` : ""}. Paste a new key to replace.`
              : provider.instructionsHint || "Saved to ~/.opencandle/config.json."}
        </p>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        {provider.signupUrl ? (
          <Button
            variant="ghost"
            size="sm"
            suffixIcon={ExternalLink}
            onClick={() => window.open(provider.signupUrl, "_blank", "noreferrer")}
          >
            Get a key
          </Button>
        ) : null}
        <Button variant="brand" size="sm" onClick={save} disabled={!canSave}>
          {status === "file" ? "Replace key" : "Save key"}
        </Button>
      </div>
    </div>
  );
}

function ExternalToolProviderBuilder({ provider, send, setToast }) {
  const status = providerStatus(provider);
  const detail = provider.statusDetail;
  const reenable = status === "skipped";

  const checkInstall = () => {
    setToast?.(
      reenable
        ? `Re-enabling ${provider.displayName} and checking install status...`
        : `Checking ${provider.displayName} install status...`,
    );
    send?.("provider.status.check", { providerId: provider.id, mode: "install", reenable });
  };
  const checkSession = () => {
    setToast?.(
      reenable
        ? `Re-enabling ${provider.displayName} and checking session. This may read browser cookies and trigger a Keychain prompt.`
        : `Checking ${provider.displayName} session. This may read browser cookies and trigger a Keychain prompt.`,
    );
    send?.("provider.status.check", { providerId: provider.id, mode: "session", reenable });
  };
  const copyInstall = () => {
    void navigator.clipboard?.writeText?.(provider.installCmd);
    setToast?.("Install command copied.");
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderStatusDot status={status} />
          <span className={cn("text-xs font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
          {detail?.checkedAt ? (
            <span className="text-[11px] text-muted-foreground">
              Checked {formatRelativeTime(detail.checkedAt)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{provider.fallbackDescription}</p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Install
        </span>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] text-foreground">
            {provider.installCmd}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copy install command"
            tooltip="Copy install command"
            onClick={copyInstall}
          >
            <Clipboard />
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Session source
        </span>
        <p className="text-sm leading-5 text-muted-foreground">
          Uses your normal browser session. Supported browsers:{" "}
          {(provider.supportedBrowsers || []).join(", ") || "Chrome, Arc, Edge, Firefox, Brave"}.
        </p>
        {detail?.message ? (
          <p className="rounded-md border border-border bg-secondary px-3 py-2 text-xs leading-5 text-muted-foreground">
            {detail.message}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="bordered" size="sm" prefixIcon={RefreshCw} onClick={checkInstall}>
          {reenable ? "Re-enable & check install" : "Check install"}
        </Button>
        <Button variant="brand" size="sm" onClick={checkSession}>
          {reenable ? "Re-enable & check session" : "Check session"}
        </Button>
      </div>
    </div>
  );
}

function PublicHttpProviderBuilder({ provider, send, setToast }) {
  const status = providerStatus(provider);
  const detail = provider.statusDetail;
  const checkReachability = () => {
    setToast?.(`Checking ${provider.displayName} reachability...`);
    send?.("provider.status.check", { providerId: provider.id });
  };

  return (
    <div className="grid gap-5 px-4 py-4 sm:px-5">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderStatusDot status={status} />
          <span className={cn("text-xs font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
          {detail?.checkedAt ? (
            <span className="text-[11px] text-muted-foreground">
              Checked {formatRelativeTime(detail.checkedAt)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {provider.fallbackDescription || "No account or API key is required."}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Probe
        </span>
        <code className="overflow-x-auto rounded-md border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
          {provider.probeUrl}
        </code>
        {detail?.message ? (
          <p className="text-xs leading-5 text-muted-foreground">{detail.message}</p>
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:-mx-5 sm:px-5">
        <Button variant="brand" size="sm" prefixIcon={RefreshCw} onClick={checkReachability}>
          Check reachability
        </Button>
      </div>
    </div>
  );
}

function PromptPreview({ prompt, title = "Chat prompt" }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground">
        {prompt || "Fill the required fields to preview the chat prompt."}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSelection(selection, catalog) {
  if (!selection || !catalog) return null;
  if (selection.kind === "workflow")
    return catalog.workflows?.find((w) => w.id === selection.id) ?? null;
  if (selection.kind === "tool") return catalog.tools?.find((t) => t.name === selection.id) ?? null;
  if (selection.kind === "provider")
    return catalog.providers?.find((p) => p.id === selection.id) ?? null;
  return null;
}

function builderTitle(selection, entity) {
  if (!entity) return "Catalog";
  if (selection.kind === "workflow") return entity.name;
  if (selection.kind === "tool") return entity.label || prettyToolName(entity.name);
  if (selection.kind === "provider") return entity.displayName;
  return "Catalog";
}

function prettyToolName(name) {
  return String(name || "")
    .replace(/^get_/, "")
    .replace(/_/g, " ");
}

function coerceValues(fields, values) {
  const out = {};
  for (const field of fields) {
    out[field.name] = coerceFieldValue(field, values[field.name]);
  }
  return out;
}

function stripEmpty(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
      continue;
    out[key] = value;
  }
  return out;
}

export function formatArgsForPrompt(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return ` with ${entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(", ")}`;
}

function formatValue(value) {
  if (Array.isArray(value)) {
    if (value.some((item) => item != null && typeof item === "object"))
      return JSON.stringify(value);
    return value.join(",");
  }
  if (value != null && typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && value.includes(" ")) return JSON.stringify(value);
  return String(value);
}

function safeBuildPrompt(schema, values) {
  try {
    return schema.buildPrompt(values) || "";
  } catch {
    return "";
  }
}

function filterTools(tools, query) {
  if (!query.trim()) return tools;
  const q = query.toLowerCase();
  return tools.filter((tool) =>
    [tool.name, tool.label, tool.description, tool.domain].some((field) =>
      String(field || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

function filterWorkflows(workflows, query) {
  if (!query.trim()) return workflows;
  const q = query.toLowerCase();
  return workflows.filter((workflow) =>
    [workflow.id, workflow.name, workflow.description].some((field) =>
      String(field || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

function filterProviders(providers, query) {
  if (!query.trim()) return providers;
  const q = query.toLowerCase();
  return providers.filter((provider) =>
    [
      provider.id,
      provider.kind,
      provider.displayName,
      provider.envVar,
      provider.binary,
      provider.installCmd,
      provider.probeUrl,
      ...(provider.aliases || []),
      ...(provider.unlocks || []),
    ].some((field) =>
      String(field || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function providerStatus(provider) {
  return provider.statusDetail?.state ?? provider.status ?? provider.source ?? "absent";
}

function providerIcon(provider) {
  if (provider.kind === "external-tool") return Terminal;
  if (provider.kind === "public-http") return Globe2;
  return KeyRound;
}

function ProviderStatusDot({ status }) {
  const cls = successStatuses.has(status)
    ? "bg-success"
    : infoStatuses.has(status)
      ? "bg-info"
      : dangerStatuses.has(status)
        ? "bg-destructive"
        : "bg-warning";
  return <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 rounded-full", cls)} />;
}

function statusLabel(status) {
  if (status === "configured") return "Configured";
  if (status === "file") return "Configured";
  if (status === "env") return "From environment";
  if (status === "installed") return "Installed";
  if (status === "missing") return "Missing";
  if (status === "session_ok") return "Session ready";
  if (status === "session_missing") return "Login needed";
  if (status === "session_stale") return "Session stale";
  if (status === "skipped") return "Skipped";
  if (status === "reachable") return "Reachable";
  if (status === "unreachable") return "Unreachable";
  if (status === "error") return "Needs attention";
  if (status === "unknown") return "Not verified yet";
  return "Not configured";
}

function statusColor(status) {
  if (successStatuses.has(status)) return "text-success";
  if (infoStatuses.has(status)) return "text-info";
  if (dangerStatuses.has(status)) return "text-destructive";
  return "text-warning";
}

const successStatuses = new Set(["configured", "file", "installed", "session_ok", "reachable"]);
const infoStatuses = new Set(["env", "skipped"]);
const dangerStatuses = new Set(["error", "unreachable"]);

function formatRelativeTime(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
