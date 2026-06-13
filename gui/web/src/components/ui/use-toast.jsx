import { useEffect, useState } from "react";

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 1_000;

let count = 0;
let memoryState = { toasts: [] };
const listeners = [];
const toastTimeouts = new Map();

function nextId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return String(count);
}

function addToRemoveQueue(toastId) {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "remove", toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
}

function reducer(state, action) {
  switch (action.type) {
    case "add":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "update":
      return {
        ...state,
        toasts: state.toasts.map((toast) =>
          toast.id === action.toast.id ? { ...toast, ...action.toast } : toast,
        ),
      };
    case "dismiss": {
      const toastId = action.toastId;
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        for (const toast of state.toasts) {
          addToRemoveQueue(toast.id);
        }
      }
      return {
        ...state,
        toasts: state.toasts.map((toast) =>
          toastId === undefined || toast.id === toastId ? { ...toast, open: false } : toast,
        ),
      };
    }
    case "remove":
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.toastId),
      };
    default:
      return state;
  }
}

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  for (const listener of listeners) {
    listener(memoryState);
  }
}

export function toast({ title, description, variant = "default", ...props }) {
  const id = nextId();
  const update = (nextProps) => dispatch({ type: "update", toast: { ...nextProps, id } });
  const dismiss = () => dispatch({ type: "dismiss", toastId: id });

  dispatch({
    type: "add",
    toast: {
      ...props,
      id,
      title,
      description,
      variant,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return { id, dismiss, update };
}

export function dismissToast(toastId) {
  dispatch({ type: "dismiss", toastId });
}

export function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: dismissToast,
  };
}
