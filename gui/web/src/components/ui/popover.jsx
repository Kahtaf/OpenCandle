import { cloneElement, forwardRef, isValidElement, useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils.js";

export function Popover({ open: openProp, defaultOpen = false, onOpenChange, children }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = useCallback((next) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }, [onOpenChange, openProp]);
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const triggerId = useId();
  const contentId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
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
  }, [open, setOpen]);

  const context = { open, setOpen, triggerRef, contentRef, triggerId, contentId };
  return (
    <PopoverContext.Provider value={context}>
      {children}
    </PopoverContext.Provider>
  );
}

import { createContext, useContext } from "react";
const PopoverContext = createContext(null);
function usePopover() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover subcomponents must be used inside <Popover>");
  return ctx;
}

export const PopoverTrigger = forwardRef(function PopoverTrigger({ children, asChild = false, onClick, ...props }, _ref) {
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
    id: triggerId,
    onClick: handleClick,
    ref: triggerRef,
    ...props,
  };
  if (asChild && isValidElement(children)) {
    return cloneElement(children, triggerProps);
  }
  return <button type="button" {...triggerProps}>{children}</button>;
});

export const PopoverContent = forwardRef(function PopoverContent({ className, align = "start", side = "bottom", sideOffset = 6, children, ...props }, _ref) {
  const { open, contentRef, contentId, triggerId } = usePopover();
  if (!open) return null;
  const alignClass = align === "end" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  const sideClass = side === "top"
    ? `bottom-full mb-[var(--popover-offset)]`
    : `top-full mt-[var(--popover-offset)]`;
  return (
    <div
      ref={contentRef}
      id={contentId}
      role="menu"
      aria-labelledby={triggerId}
      style={{ "--popover-offset": `${sideOffset}px` }}
      className={cn(
        "absolute z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-card shadow-subtle-md outline-none animate-in fade-in-0 zoom-in-95",
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

export function PopoverAnchor({ children, className }) {
  return <div className={cn("relative inline-block", className)}>{children}</div>;
}
