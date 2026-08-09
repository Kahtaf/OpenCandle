// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypedConfirmDialog } from "../../../gui/web/src/components/ui/typed-confirm-dialog.jsx";
import { TYPED_CONFIRM_WORD } from "../../../gui/web/src/components/ui/typed-confirm-word.js";

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TypedConfirmDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function render(props: Record<string, unknown> = {}) {
    act(() => {
      root.render(
        React.createElement(TypedConfirmDialog, {
          open: true,
          onOpenChange: () => {},
          title: "Clear all data?",
          description: "This removes everything OpenCandle keeps in this browser.",
          items: ["Saved sessions", "Market state", "Model keys"],
          confirmLabel: "Clear all",
          onConfirm: () => {},
          ...props,
        }),
      );
    });
    const dialog = document.querySelector('[data-slot="typed-confirm-dialog"]') as HTMLElement;
    return {
      dialog,
      input: dialog.querySelector("input") as HTMLInputElement,
      confirm: dialog.querySelector('[data-slot="typed-confirm-action"]') as HTMLButtonElement,
    };
  }

  it("explains what is deleted and keeps the destructive action disabled until the word matches", () => {
    const onConfirm = vi.fn();
    const { dialog, input, confirm } = render({ onConfirm });

    expect(dialog.textContent).toContain("Saved sessions");
    expect(dialog.textContent).toContain("Market state");
    expect(dialog.textContent).toContain(TYPED_CONFIRM_WORD);
    expect(confirm.disabled).toBe(true);

    act(() => setValue(input, "delete me"));
    expect(confirm.disabled).toBe(true);

    act(() => setValue(input, TYPED_CONFIRM_WORD));
    expect(confirm.disabled).toBe(false);

    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores surrounding whitespace but not a different word", () => {
    const { input, confirm } = render();

    act(() => setValue(input, `  ${TYPED_CONFIRM_WORD} `));
    expect(confirm.disabled).toBe(false);

    act(() => setValue(input, TYPED_CONFIRM_WORD.toLowerCase()));
    expect(confirm.disabled).toBe(true);
  });

  it("does not confirm when the dialog is cancelled", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const { dialog } = render({ onConfirm, onOpenChange });

    const cancel = dialog.querySelector('[data-slot="alert-dialog-cancel"]') as HTMLButtonElement;
    act(() => cancel.click());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("forgets a typed confirmation when the dialog closes and reopens", () => {
    const { input } = render();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "DELETE");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      root.render(
        React.createElement(TypedConfirmDialog, {
          open: false,
          onOpenChange: () => {},
          title: "Clear all data?",
          confirmLabel: "Clear all",
          onConfirm: () => {},
        }),
      );
    });
    expect(document.querySelector('[data-slot="typed-confirm-dialog"]')).toBeNull();
    const reopened = render({ open: true });
    expect(reopened.input.value).toBe("");
    expect(reopened.confirm.disabled).toBe(true);
  });

  it("stays disabled while the action is pending", () => {
    const { input, confirm } = render({ pending: true });

    act(() => setValue(input, TYPED_CONFIRM_WORD));
    expect(confirm.disabled).toBe(true);
  });
});
