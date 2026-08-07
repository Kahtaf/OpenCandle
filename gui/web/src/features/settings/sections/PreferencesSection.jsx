import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../../components/ui/alert-dialog.jsx";
import { Button } from "../../../components/ui/button.jsx";
import { Card } from "../../../components/ui/card.jsx";
import { Skeleton } from "../../../components/ui/skeleton.jsx";
import { useRuntimeTransport } from "../../../runtime/runtime-transport-context.js";

/**
 * Settings -> Preferences.
 *
 * The first UI over the two stores the agent writes silently: `user_preferences`
 * and `tool_defaults`. Read and delete only. Editing a saved value is out of
 * scope; a wrong value is removed and re-learned from the next conversation.
 */
function normalizeSnapshot(value) {
  return {
    preferences: Array.isArray(value?.preferences) ? value.preferences : [],
    toolDefaults: Array.isArray(value?.toolDefaults) ? value.toolDefaults : [],
  };
}

export function PreferencesSection({ role = "writer", setToast, preferencesSnapshot }) {
  const transport = useRuntimeTransport();
  const hosted = transport?.kind === "hosted";
  // An offline tab and a local follower are read-only. An online hosted
  // follower forwards mutations to the elected writer, exactly as it does for
  // saved market state.
  const readOnly = role === "offline" || (role !== "writer" && !hosted);

  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [pendingRow, setPendingRow] = useState("");
  const [adoptedPush, setAdoptedPush] = useState(null);
  // Bumped whenever a pushed broadcast is adopted; a fetch that started
  // before the bump is stale and must not overwrite the newer push.
  const pushEpochRef = useRef(0);

  // The local server broadcasts a fresh snapshot after any preference
  // mutation, including one made from another window. Adopt it during
  // render (the sanctioned derive-state-from-props form) so no effect
  // resets state from a prop change.
  if (preferencesSnapshot && preferencesSnapshot !== adoptedPush) {
    setAdoptedPush(preferencesSnapshot);
    setSnapshot(normalizeSnapshot(preferencesSnapshot));
    setError("");
    pushEpochRef.current += 1;
  }

  const load = useCallback(
    async (signal) => {
      const startEpoch = pushEpochRef.current;
      try {
        const next = await transport.getPreferences(signal);
        if (signal?.aborted) return;
        // A broadcast that arrived while this read was in flight is newer
        // than what the read started from; keep the pushed rows.
        if (pushEpochRef.current !== startEpoch) return;
        setSnapshot(normalizeSnapshot(next));
        setError("");
      } catch (loadError) {
        if (signal?.aborted) return;
        // Never fall back to the empty state here: "nothing saved" and "could
        // not read what is saved" are different answers.
        setError(messageOf(loadError));
      }
    },
    [transport],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Agent turns can persist a new preference without a broadcast reaching
  // this tab, so returning to the page re-reads the durable store.
  useEffect(() => {
    const refetch = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [load]);

  const runDelete = useCallback(
    async (rowId, remove) => {
      if (readOnly) return;
      setPendingRow(rowId);
      try {
        await remove();
        // The delete is acknowledged; re-read so this window also picks up any
        // change another window made while the dialog was open.
        await load();
      } catch (deleteError) {
        setToast?.(messageOf(deleteError), { destructive: true });
      } finally {
        setPendingRow("");
      }
    },
    [load, readOnly, setToast],
  );

  if (error) {
    return (
      <Card
        className="min-w-0 p-4 text-sm text-destructive"
        role="alert"
        data-slot="preferences-error"
      >
        {error}
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="grid min-w-0 gap-3 p-4" data-slot="preferences-loading">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    );
  }

  const { preferences, toolDefaults } = snapshot;

  if (preferences.length === 0 && toolDefaults.length === 0) {
    return (
      <p
        className="m-0 text-pretty text-sm leading-relaxed text-muted-foreground"
        data-slot="preferences-empty"
      >
        OpenCandle saves preferences it learns from your conversations, such as your risk profile or
        a tool setting you reuse. Nothing is saved yet.
      </p>
    );
  }

  return (
    <div className="grid min-w-0 gap-4" data-slot="preferences-section">
      {readOnly ? (
        <p className="m-0 text-xs text-muted-foreground" data-slot="preferences-read-only">
          Removing a saved preference is unavailable in this window while OpenCandle reconnects to
          this session.
        </p>
      ) : null}

      {preferences.length > 0 ? (
        <PreferenceGroup
          title="Preferences"
          description="What OpenCandle has learned about how you invest. These reach the agent as context on finance turns."
        >
          {preferences.map((row) => {
            const rowId = `preference:${row.namespace}:${row.key}`;
            return (
              <SettingRow
                key={rowId}
                slot="preference-row"
                name={row.key}
                qualifier={row.namespace}
                value={formatValue(row.value)}
                facts={[
                  row.source ? `Source ${row.source}` : "",
                  row.confidence ? `Confidence ${row.confidence}` : "",
                  formatTimestamp(row.updatedAt, "Updated"),
                ]}
                deleteSlot="preference-delete"
                confirmSlot="preference-delete-confirm"
                confirmTitle={`Delete the saved ${row.key}?`}
                confirmBody="OpenCandle stops using this preference from the next turn. It can be learned again from a later conversation."
                disabled={readOnly}
                pending={pendingRow === rowId}
                onDelete={() =>
                  runDelete(rowId, () =>
                    transport.deletePreference({ namespace: row.namespace, key: row.key }),
                  )
                }
              />
            );
          })}
        </PreferenceGroup>
      ) : null}

      {toolDefaults.length > 0 ? (
        <PreferenceGroup
          title="Tool defaults"
          description="Values a tool reuses when a request does not name its own."
        >
          {toolDefaults.map((row) => {
            const rowId = `tool-default:${row.toolName}:${row.paramPath}`;
            return (
              <SettingRow
                key={rowId}
                slot="tool-default-row"
                name={row.paramPath}
                qualifier={row.toolName}
                value={formatValue(row.value)}
                facts={[formatTimestamp(row.setAt, "Set")]}
                deleteSlot="tool-default-delete"
                confirmSlot="tool-default-delete-confirm"
                confirmTitle={`Delete the ${row.toolName} default for ${row.paramPath}?`}
                confirmBody="The tool falls back to its own default the next time it runs without this value."
                disabled={readOnly}
                pending={pendingRow === rowId}
                onDelete={() =>
                  runDelete(rowId, () =>
                    transport.deleteToolDefault({
                      toolName: row.toolName,
                      paramPath: row.paramPath,
                    }),
                  )
                }
              />
            );
          })}
        </PreferenceGroup>
      ) : null}
    </div>
  );
}

function PreferenceGroup({ title, description, children }) {
  return (
    <section className="min-w-0" data-slot="preferences-group">
      <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
      <p className="m-0 mt-1 max-w-[68ch] text-pretty text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Card className="mt-2 min-w-0 divide-y divide-border overflow-hidden p-0">{children}</Card>
    </section>
  );
}

function SettingRow({
  slot,
  name,
  qualifier,
  value,
  facts,
  deleteSlot,
  confirmSlot,
  confirmTitle,
  confirmBody,
  disabled,
  pending,
  onDelete,
}) {
  const shownFacts = facts.filter(Boolean);
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 px-4 py-3" data-slot={slot}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{qualifier}</span>
        </div>
        <p className="m-0 mt-1 break-words text-sm text-foreground">{value}</p>
        {shownFacts.length > 0 ? (
          <p className="m-0 mt-1 text-xs text-muted-foreground">{shownFacts.join(" · ")}</p>
        ) : null}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={disabled || pending}
            aria-busy={pending ? "true" : undefined}
            data-slot={deleteSlot}
          >
            <Trash2 className="button-icon" aria-hidden="true" />
            <span className="sr-only">Delete {name}</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-slot={confirmSlot}
              onClick={() => onDelete?.()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Scalars read as themselves; anything structured reads as compact JSON so a
// saved object is inspectable instead of rendering as [object Object].
function formatValue(value) {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTimestamp(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return `${label} ${text}`;
  return `${label} ${parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
