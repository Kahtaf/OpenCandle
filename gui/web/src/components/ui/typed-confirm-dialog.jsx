import { useId, useState } from "react";
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
import { TYPED_CONFIRM_WORD } from "./typed-confirm-word.js";

const NO_ITEMS = Object.freeze([]);

function TypedConfirmBody({
  title,
  description,
  items,
  confirmLabel,
  confirmWord,
  cancelLabel,
  pending,
  onConfirm,
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === confirmWord;

  return (
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
  );
}

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  items = NO_ITEMS,
  confirmLabel,
  confirmWord = TYPED_CONFIRM_WORD,
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <TypedConfirmBody
          title={title}
          description={description}
          items={items}
          confirmLabel={confirmLabel}
          confirmWord={confirmWord}
          cancelLabel={cancelLabel}
          pending={pending}
          onConfirm={onConfirm}
        />
      ) : null}
    </AlertDialog>
  );
}
