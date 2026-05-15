import { CandlestickChart, PanelLeft, Plus, Search, X } from "lucide-react";
import { HistoryItem } from "../../components/chat/history-item.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Kbd } from "../../components/ui/kbd.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";

const DAY_MS = 24 * 60 * 60 * 1000;

export function SessionSidebar({ collapsed, onCollapse, ...props }) {
  if (collapsed) return null;
  return (
    <aside className="hidden h-full w-[260px] shrink-0 overflow-hidden border-r border-border bg-secondary md:block">
      <SidebarBody {...props} onClose={onCollapse} closeLabel="Collapse sidebar" closeIcon={PanelLeft} />
    </aside>
  );
}

export function SessionDrawer({ open, onClose, ...rest }) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent width="sm" handleLabel="Sessions" className="bg-secondary p-0">
        <div className="flex h-full min-h-0 flex-col">
          <SidebarBody {...rest} onClose={onClose} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SidebarBody({ sessions, currentSessionId, onOpenSession, onRenameSession, onDeleteSession, onNewSession, onClose, closeLabel = "Close sidebar", closeIcon: CloseIcon = X }) {
  const groups = groupSessions(sessions);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-2 px-1">
        <CandlestickChart className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} aria-hidden="true" />
        <span className="text-sm font-semibold tracking-tight text-foreground">OpenCandle</span>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </Button>
        ) : (
          <PanelLeft className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <Button variant="bordered" className="w-full justify-center gap-2" onClick={onNewSession}>
        <Plus /> New chat
      </Button>

      <SearchField />

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        <ThreadGroup label="Today" sessions={groups.today} currentSessionId={currentSessionId} onOpenSession={onOpenSession} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
        <ThreadGroup label="Yesterday" sessions={groups.yesterday} currentSessionId={currentSessionId} onOpenSession={onOpenSession} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
        <ThreadGroup label="Earlier" sessions={groups.earlier} currentSessionId={currentSessionId} onOpenSession={onOpenSession} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
        {sessions.length === 0 ? (
          <p className="px-3 text-xs text-muted-foreground">Current local session</p>
        ) : null}
      </div>
    </div>
  );
}

function SearchField() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 transition-colors focus-within:border-foreground/40">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label className="sr-only" htmlFor="session-search">Search</label>
      <Input variant="ghost" id="session-search" placeholder="Search" className="h-9 px-0 text-sm shadow-none" />
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
    </div>
  );
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {children}
    </div>
  );
}

function ThreadGroup({ label, sessions, currentSessionId, onOpenSession, onRenameSession, onDeleteSession }) {
  if (!sessions?.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <SectionLabel>{label}</SectionLabel>
      {sessions.map((session) => (
        <HistoryItem
          key={session.path}
          session={session}
          active={session.id === currentSessionId}
          onOpen={onOpenSession}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
        />
      ))}
    </div>
  );
}

function groupSessions(sessions) {
  const now = Date.now();
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const groups = { today: [], yesterday: [], earlier: [] };
  for (const session of sessions) {
    const t = new Date(session.modified).getTime();
    if (Number.isNaN(t)) {
      groups.earlier.push(session);
      continue;
    }
    if (t >= today) groups.today.push(session);
    else if (t >= yesterday) groups.yesterday.push(session);
    else groups.earlier.push(session);
  }
  return groups;
}

function startOfDay(epoch) {
  const d = new Date(epoch);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
