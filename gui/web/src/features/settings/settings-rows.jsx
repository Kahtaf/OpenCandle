import { cn } from "../../lib/utils.js";

// Settings card and row grammar: a titled card holding flat rows of
// label, one line of description, and a right aligned control or status.
export function SettingsCard({ title, description, children, className }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {title ? (
        <header className="border-b border-border px-4 py-3">
          <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="m-0 mt-1 text-pretty text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsRow({ label, description, control, tone = "default", className }) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "m-0 text-sm font-medium",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </p>
        {description ? (
          <p className="m-0 mt-0.5 text-pretty text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {control ? <div className="shrink-0 sm:text-right">{control}</div> : null}
    </div>
  );
}

export function SettingsBody({ children, className }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function SettingsNote({ children }) {
  return <p className="m-0 px-1 text-pretty text-xs text-muted-foreground">{children}</p>;
}
