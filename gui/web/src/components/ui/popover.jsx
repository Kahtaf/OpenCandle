import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils.js";

const CLOSE_ANIMATION_MS = 120;

export function Popover({ open: openProp, defaultOpen = false, onOpenChange, children }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : openState;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = useCallback(
    (next) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChangeRef.current?.(next);
    },
    [openProp],
  );
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const triggerId = useId();
  const contentId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      const owningTrigger =
        target instanceof Element ? target.closest("[data-popover-trigger]") : null;
      if (owningTrigger?.getAttribute("data-popover-trigger") === triggerId) return;
      const owningContent = target instanceof Element ? target.closest('[role="menu"]') : null;
      if (owningContent?.id === contentId) return;
      if (triggerRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus?.();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [contentId, open, setOpen, triggerId]);

  const context = {
    open,
    setOpen,
    triggerRef,
    contentRef,
    triggerId,
    contentId,
  };
  return <PopoverContext.Provider value={context}>{children}</PopoverContext.Provider>;
}

import { createContext, useContext } from "react";

const PopoverContext = createContext(null);
function usePopover() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover subcomponents must be used inside <Popover>");
  return ctx;
}

export const PopoverTrigger = forwardRef(function PopoverTrigger(
  { children, asChild = false, onClick, ...props },
  _ref,
) {
  const { open, setOpen, triggerRef, triggerId, contentId } = usePopover();
  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    setOpen(!open);
  };
  const triggerProps = {
    "aria-expanded": open,
    "aria-haspopup": "menu",
    "aria-controls": open ? contentId : undefined,
    "data-popover-trigger": triggerId,
    id: triggerId,
    onClick: handleClick,
    ref: triggerRef,
    ...props,
  };
  if (asChild && isValidElement(children)) {
    return cloneElement(children, triggerProps);
  }
  return (
    <button type="button" {...triggerProps}>
      {children}
    </button>
  );
});

export const PopoverContent = forwardRef(function PopoverContent(
  { className, align = "start", side = "bottom", sideOffset = 6, children, ...props },
  _ref,
) {
  const { open, contentRef, contentId, triggerId } = usePopover();
  const [closeAnimationComplete, setCloseAnimationComplete] = useState(!open);
  useEffect(() => {
    if (open) {
      setCloseAnimationComplete(false);
      return undefined;
    }
    if (closeAnimationComplete) return undefined;
    const timeout = window.setTimeout(() => setCloseAnimationComplete(true), CLOSE_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [closeAnimationComplete, open]);
  const state = open ? "open" : closeAnimationComplete ? "dormant" : "closed";
  const alignClass =
    align === "end" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  const sideClass =
    side === "top"
      ? `bottom-full mb-[var(--popover-offset)]`
      : `top-full mt-[var(--popover-offset)]`;
  return (
    <div
      ref={contentRef}
      id={contentId}
      role="menu"
      aria-labelledby={triggerId}
      aria-hidden={!open}
      inert={!open}
      data-state={state}
      style={{ "--popover-offset": `${sideOffset}px` }}
      className={cn(
        "absolute z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-card shadow-subtle-md outline-none data-[state=dormant]:hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms] data-[state=closed]:ease-in",
        side === "top"
          ? "data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:slide-out-to-bottom-1"
          : "data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1",
        sideClass,
        alignClass,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function PopoverAnchor({ children, className, style }) {
  return (
    <div className={cn("relative inline-block", className)} style={style}>
      {children}
    </div>
  );
}
