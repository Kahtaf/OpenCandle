import { Link } from "@tanstack/react-router";
import {
  Bell,
  BriefcaseBusiness,
  ClipboardCheck,
  FileText,
  ListPlus,
  PanelLeft,
  Plus,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OpenCandleLogo } from "../../components/brand/opencandle-logo.jsx";
import { HistoryItem } from "../../components/chat/history-item.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import { filterSessions } from "./session-search.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function SessionSidebar({ collapsed, onCollapse, ...props }) {
  if (collapsed) return null;
  return (
    <aside className="hidden h-full w-[260px] shrink-0 overflow-hidden border-r border-border bg-secondary md:block">
      <SidebarBody
        {...props}
        onClose={onCollapse}
        closeLabel="Collapse sidebar"
        closeIcon={PanelLeft}
      />
    </aside>
  );
}

export function SessionDrawer({ open, onClose, ...rest }) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent width="sm" handleLabel="Sessions" className="bg-secondary p-0">
        <div className="flex h-full min-h-0 flex-col">
          <SidebarBody {...rest} showHeader={false} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SidebarBody({
  sessions,
  currentSessionId,
  currentPath = "",
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onNewSession,
  onOpenHome,
  onClose,
  showHeader = true,
  closeLabel = "Close sidebar",
  closeIcon: CloseIcon = X,
}) {
  const [query, setQuery] = useState("");
  const filteredSessions = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const groups = useMemo(() => groupSessions(filteredSessions), [filteredSessions]);
  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
      {showHeader ? (
        <div className="flex items-center gap-2 px-1">
          <button
            type="button"
            aria-label="Go to new chat"
            onClick={onOpenHome}
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold tracking-tight text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OpenCandleLogo />
            <span className="truncate">OpenCandle</span>
          </button>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <CloseIcon />
            </Button>
          ) : (
            <PanelLeft
              className="ml-auto h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
      ) : null}

      <Button variant="bordered" className="w-full justify-center gap-2" onClick={onNewSession}>
        <Plus /> New chat
      </Button>

      <SearchField value={query} onChange={setQuery} />

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        <MarketStateNav currentPath={currentPath} />
        <ThreadGroup
          label="Today"
          sessions={groups.today}
          currentSessionId={currentSessionId}
          onOpenSession={onOpenSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
        />
        <ThreadGroup
          label="Yesterday"
          sessions={groups.yesterday}
          currentSessionId={currentSessionId}
          onOpenSession={onOpenSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
        />
        <ThreadGroup
          label="Earlier"
          sessions={groups.earlier}
          currentSessionId={currentSessionId}
          onOpenSession={onOpenSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
        />
        {hasQuery && filteredSessions.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matching chats</p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="px-3 text-xs text-muted-foreground">Current local session</p>
        ) : null}
      </div>
    </div>
  );
}

function MarketStateNav({ currentPath }) {
  const items = [
    { to: "/watchlists", label: "Watchlists", icon: ListPlus },
    { to: "/portfolios", label: "Portfolios", icon: BriefcaseBusiness },
    { to: "/alerts", label: "Alerts", icon: Bell },
    { to: "/reports", label: "Reports", icon: FileText },
    { to: "/diagnostics", label: "Diagnostics", icon: ClipboardCheck },
  ];
  return (
    <div className="flex flex-col gap-0.5 border-b border-border pb-2">
      <SectionLabel>Market State</SectionLabel>
      {items.map((item) => {
        const active = currentPath === item.to;
        const Icon = item.icon;
        return (
          <Button
            key={item.to}
            asChild
            variant={active ? "default" : "ghost"}
            size="sm"
            className="w-full justify-start"
          >
            <Link to={item.to}>
              <Icon className="button-icon" aria-hidden="true" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

function SearchField({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 transition-colors focus-within:border-foreground/40">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label className="sr-only" htmlFor="session-search">
        Search
      </label>
      <Input
        variant="ghost"
        id="session-search"
        placeholder="Search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 px-0 text-sm shadow-none"
      />
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

function ThreadGroup({
  label,
  sessions,
  currentSessionId,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
}) {
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
