import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../ui/popover.jsx";

export const sessionMenuLongPressDelayMs = 500;

export function isSessionMenuLongPressPointer(pointerType) {
  return pointerType === "touch" || pointerType === "pen";
}

export function HistoryItem({ session, active, onOpen, onRename, onDelete }) {
  const title = session.name || session.firstMessage || "Untitled session";
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const suppressOpenRef = useRef(false);

  useEffect(() => {
    if (!renaming) setDraft(title);
  }, [renaming, title]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    }
  }, [renaming]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const openContextMenu = () => {
    clearLongPressTimer();
    suppressOpenRef.current = true;
    setMenuOpen(true);
  };

  const startLongPress = (event) => {
    if (!isSessionMenuLongPressPointer(event.pointerType)) return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(openContextMenu, sessionMenuLongPressDelayMs);
  };

  const submitRename = () => {
    const next = draft.trim();
    if (!next) return;
    onRename?.(session, next);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <form
        className={cn("rounded-md px-2 py-1.5", active ? "bg-tertiary" : "bg-background")}
        onSubmit={(event) => {
          event.preventDefault();
          submitRename();
        }}
      >
        <label className="sr-only" htmlFor={`rename-session-${session.id}`}>
          Rename session
        </label>
        <input
          ref={inputRef}
          id={`rename-session-${session.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={submitRename}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(title);
              setRenaming(false);
            }
          }}
          className="h-7 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition-colors focus-within:bg-tertiary hover:bg-tertiary",
        active ? "bg-tertiary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <button
        type="button"
        data-long-press-menu
        onPointerDown={startLongPress}
        onPointerUp={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onContextMenu={(event) => {
          event.preventDefault();
          openContextMenu();
        }}
        onClick={(event) => {
          if (suppressOpenRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressOpenRef.current = false;
            return;
          }
          onOpen(session);
        }}
        className="min-h-10 min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={title}
      >
        {title}
      </button>
      <Popover
        open={menuOpen}
        onOpenChange={(nextOpen) => {
          setMenuOpen(nextOpen);
          if (!nextOpen) suppressOpenRef.current = false;
        }}
      >
        <PopoverAnchor className="mr-1 shrink-0">
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Session options for ${title}`}
              className={cn(
                "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                menuOpen && "opacity-100",
              )}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <MoreHorizontal />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-44 p-1">
            <button
              type="button"
              role="menuitem"
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-destructive transition-[background-color,color,transform,scale] duration-150 ease-out hover:bg-destructive/10 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm(`Delete "${title}"?`)) onDelete?.(session);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete chat
            </button>
          </PopoverContent>
        </PopoverAnchor>
      </Popover>
    </div>
  );
}
