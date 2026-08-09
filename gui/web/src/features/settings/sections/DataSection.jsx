import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog.jsx";
import { Button } from "../../../components/ui/button.jsx";
import { TypedConfirmDialog } from "../../../components/ui/typed-confirm-dialog.jsx";
import { useWaitingServiceWorker } from "../../../hooks/use-waiting-service-worker.js";
import { useRuntimeTransport } from "../../../runtime/runtime-transport-context.js";
import { SettingsCard, SettingsNote, SettingsRow } from "../settings-rows.jsx";

const READ_ONLY_MESSAGE = "Data actions are unavailable while OpenCandle reconnects local access.";

export function DataSection({ role, setToast }) {
  const transport = useRuntimeTransport();
  const hosted = transport.kind === "hosted";
  return hosted ? (
    <HostedData actions={transport.hostedData} role={role} setToast={setToast} />
  ) : (
    <LocalData transport={transport} />
  );
}

function HostedData({ actions, role, setToast }) {
  const importRef = useRef(null);
  const waitingWorker = useWaitingServiceWorker();
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");
  // A hosted follower forwards data commands to the elected writer through
  // the coordinator, so only an offline tab (or a missing runtime handle)
  // is read-only here.
  const readOnly = role === "offline" || !actions;
  const disabled = readOnly || Boolean(busy);
  // Export only reads what this browser already holds, so it stays available
  // offline and in a follower tab. Everything that writes does not.
  const exportDisabled = !actions || Boolean(busy);

  const run = async (name, action, { reads = false } = {}) => {
    if (readOnly && !reads) {
      setToast?.(READ_ONLY_MESSAGE, { destructive: true });
      return;
    }
    setBusy(name);
    try {
      await action();
    } catch (error) {
      setToast?.(error instanceof Error ? error.message : String(error), {
        destructive: true,
        title: "Data action failed",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="Your data"
        description="Sessions, saved market state, and model keys stay in this browser profile."
      >
        {waitingWorker ? (
          <SettingsRow
            label="Install update"
            description="A newer version of OpenCandle is ready. Your work is saved before it activates."
            control={
              <Button
                type="button"
                size="sm"
                variant="bordered"
                disabled={disabled}
                onClick={() => void run("update", () => actions.installUpdate(waitingWorker))}
              >
                Install update
              </Button>
            }
          />
        ) : null}
        <SettingsRow
          label="Export data"
          description="Download one file holding your sessions and saved market state. Keys are never included."
          control={
            <Button
              type="button"
              size="sm"
              variant="bordered"
              disabled={exportDisabled}
              onClick={() => void run("export", () => actions.exportData(), { reads: true })}
            >
              Export
            </Button>
          }
        />
        <SettingsRow
          label="Import data"
          description="Replace what is in this browser with a previously exported file. It is checked before anything changes."
          control={
            <>
              <Button
                type="button"
                size="sm"
                variant="bordered"
                disabled={disabled}
                onClick={() => importRef.current?.click()}
              >
                Import
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                aria-label="Import OpenCandle data file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void run("import", () => actions.importData(file));
                }}
              />
            </>
          }
        />
      </SettingsCard>

      <SettingsCard title="Remove data">
        <SettingsRow
          tone="destructive"
          label="Clear secrets"
          description="Forget the model and provider keys saved in this browser. Sessions and market state stay."
          control={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirming("secrets")}
            >
              Clear secrets
            </Button>
          }
        />
        <SettingsRow
          tone="destructive"
          label="Clear all"
          description="Remove every session, saved list, key, and cached file OpenCandle keeps on this device."
          control={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirming("all")}
            >
              Clear all
            </Button>
          }
        />
      </SettingsCard>

      {readOnly ? <SettingsNote>{READ_ONLY_MESSAGE}</SettingsNote> : null}

      <AlertDialog
        open={confirming === "secrets"}
        onOpenChange={(open) => setConfirming(open ? "secrets" : "")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear saved keys?</AlertDialogTitle>
            <AlertDialogDescription>
              OpenCandle forgets the model and data provider keys saved in this browser. Sessions
              and saved market state are untouched, and you can enter the keys again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirming("");
                void run("secrets", () => actions.clearSecrets());
              }}
            >
              Clear secrets
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TypedConfirmDialog
        open={confirming === "all"}
        onOpenChange={(open) => setConfirming(open ? "all" : "")}
        title="Clear all data on this device?"
        description="This cannot be undone. Export first if you want to keep any of it."
        items={[
          "Every saved chat session and its transcript",
          "Watchlists, portfolios, alerts, and saved reports",
          "Model and data provider keys saved in this browser",
          "Cached app files, so OpenCandle downloads them again",
        ]}
        confirmLabel="Clear all"
        pending={busy === "all"}
        onConfirm={() => {
          setConfirming("");
          void run("all", () => actions.clearAll());
        }}
      />
    </div>
  );
}

function LocalData({ transport }) {
  const [report, setReport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    void transport
      .getDiagnostics({})
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  const home = report?.metadata?.opencandleHome ?? "";
  const fromEnv = report?.metadata?.opencandleHomeSource === "env";
  const configPath = findCheckPath(report, "state.config");

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="Where your data lives"
        description="OpenCandle keeps everything on this computer. Nothing is uploaded."
      >
        <SettingsRow
          label="OpenCandle home"
          description={
            fromEnv
              ? "Sessions, saved market state, and caches live here. This location comes from OPENCANDLE_HOME."
              : "Sessions, saved market state, and caches live here."
          }
          control={<PathValue value={home} />}
        />
        <SettingsRow
          label="Provider keys"
          description="Model and data provider keys are written to the local config file, readable only by your account."
          control={<PathValue value={configPath} />}
        />
      </SettingsCard>
      <SettingsNote>
        To move or remove this data, copy or delete the folder above while OpenCandle is closed.
      </SettingsNote>
    </div>
  );
}

function PathValue({ value }) {
  if (!value) return <span className="text-xs text-muted-foreground">Not available yet</span>;
  return (
    <code className="block break-all text-xs text-muted-foreground sm:text-right">{value}</code>
  );
}

function findCheckPath(report, checkId) {
  for (const section of report?.sections ?? []) {
    for (const check of section?.checks ?? []) {
      if (check?.id === checkId && typeof check?.metadata?.path === "string") {
        return check.metadata.path;
      }
    }
  }
  return "";
}
