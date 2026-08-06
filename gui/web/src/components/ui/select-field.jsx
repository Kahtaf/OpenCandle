import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";

// One shared empty list, so an omitted `options` prop is the same value on
// every render instead of a fresh array that redraws memoized children.
const NO_OPTIONS = [];

// A form select whose options can carry a one-line description. The native
// `Select` primitive stays the right control for plain option lists; this one
// exists because an option that needs explaining cannot be written as one.
// Radix owns the listbox behaviour, so only the chrome is ours, and the chrome
// is deliberately identical to the native control's.
export function SelectField({
  id,
  value,
  onValueChange,
  options = NO_OPTIONS,
  disabled,
  placeholder = "Select an option",
  className,
  contentClassName,
  "aria-label": ariaLabel,
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        data-slot="select-field-trigger"
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-4 text-left text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:h-9",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          data-slot="select-field-content"
          className={cn(
            "z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-subtle-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[180ms] data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms]",
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                data-slot="select-field-item"
                className="relative flex cursor-default select-none flex-col gap-0.5 rounded-md py-2 pl-2.5 pr-8 text-[13px] outline-none transition-colors duration-150 ease-out data-[highlighted]:bg-secondary data-[state=checked]:bg-secondary"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.description ? (
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 top-2.5">
                  <Check aria-hidden="true" className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
