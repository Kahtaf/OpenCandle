import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Table = forwardRef(function Table({ className, containerClassName, ...props }, ref) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-auto", containerClassName)}
    >
      <table
        ref={ref}
        data-slot="table"
        className={cn("w-full caption-bottom text-[13.5px]", className)}
        {...props}
      />
    </div>
  );
});

export const TableHeader = forwardRef(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
});

export const TableBody = forwardRef(function TableBody({ className, ...props }, ref) {
  return (
    <tbody
      ref={ref}
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
});

export const TableRow = forwardRef(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      data-slot="table-row"
      className={cn("border-b border-border transition-colors hover:bg-secondary", className)}
      {...props}
    />
  );
});

export const TableHead = forwardRef(function TableHead(
  { className, scope = "col", ...props },
  ref,
) {
  return (
    <th
      ref={ref}
      data-slot="table-head"
      scope={scope}
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
});

export const TableCell = forwardRef(function TableCell({ className, ...props }, ref) {
  return (
    <td
      ref={ref}
      data-slot="table-cell"
      className={cn("p-3 align-middle text-foreground [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
});

export const TableCaption = forwardRef(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      data-slot="table-caption"
      className={cn("mt-3 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
