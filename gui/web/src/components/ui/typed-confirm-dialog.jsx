import { useEffect, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog.jsx";
import { Input } from "./input.jsx";

// A fixed, locale independent word so the confirmation reads the same for
// everyone and cannot be satisfied by a translated phrase.
export const TYPED_CONFIRM_WORD = "DELETE";

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  items = [],
  confirmLabel,
  confirmWord = TYPED_CONFIRM_WORD,
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === confirmWord;

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-slot="typed-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {items.length > 0 ? (
          <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={inputId} className="grid gap-1 text-xs font-medium text-muted-foreground">
          Type {confirmWord} to confirm
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            data-slot="typed-confirm-action"
            disabled={!matches || pending}
            onClick={() => onConfirm?.()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
