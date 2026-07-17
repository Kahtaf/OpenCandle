import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../../gui/web/src/components/ui/alert-dialog.jsx";
import { Button } from "../../../gui/web/src/components/ui/button.jsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../../../gui/web/src/components/ui/chart.jsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../../../gui/web/src/components/ui/command.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../gui/web/src/components/ui/dropdown-menu.jsx";
import { ScrollArea, ScrollBar } from "../../../gui/web/src/components/ui/scroll-area.jsx";
import { Separator } from "../../../gui/web/src/components/ui/separator.jsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../gui/web/src/components/ui/table.jsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../gui/web/src/components/ui/tabs.jsx";
import { Textarea } from "../../../gui/web/src/components/ui/textarea.jsx";

vi.mock("recharts", async (importOriginal) => {
  const ReactModule = await import("react");
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

describe("GUI UI primitives rendering", () => {
  it("keeps textareas visibly focused", () => {
    const html = renderToStaticMarkup(React.createElement(Textarea, { "aria-label": "Message" }));

    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-ring");
  });

  it("keeps icon controls named, focusable, pressable, and at least 40px square", () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, {
        "aria-label": "Open menu",
        icon: () => React.createElement("svg", null),
        size: "icon-xs",
      }),
    );

    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain("min-h-10");
    expect(html).toContain("min-w-10");
    expect(html).toContain("active:enabled:scale-[0.96]");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain(
      "transition-[background-color,border-color,color,opacity,transform,scale]",
    );
  });

  it("renders table semantics", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Table,
        null,
        React.createElement(TableCaption, null, "Portfolio positions"),
        React.createElement(
          TableHeader,
          null,
          React.createElement(TableRow, null, React.createElement(TableHead, null, "Symbol")),
        ),
        React.createElement(
          TableBody,
          null,
          React.createElement(TableRow, null, React.createElement(TableCell, null, "OC")),
        ),
      ),
    );

    expect(html).toContain("<table");
    expect(html).toContain("Portfolio positions");
    expect(html).toContain('<th data-slot="table-head" scope="col"');
    expect(html).toContain("<td");
  });

  it("renders tab roles", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Tabs,
        { defaultValue: "positions" },
        React.createElement(
          TabsList,
          null,
          React.createElement(TabsTrigger, { value: "positions" }, "Positions"),
        ),
        React.createElement(TabsContent, { value: "positions" }, "OpenCandle"),
      ),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("OpenCandle");
    expect(html).toContain("min-h-10");
    expect(html).toContain("active:scale-[0.96]");
    expect(html).toContain("transition-[background-color,color,box-shadow,transform,scale]");
    expect(html).toContain("focus-visible:ring-2");
  });

  it("renders a dropdown menu trigger", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        DropdownMenu,
        null,
        React.createElement(DropdownMenuTrigger, null, "Actions"),
        React.createElement(
          DropdownMenuContent,
          { forceMount: true },
          React.createElement(DropdownMenuItem, null, "Refresh"),
        ),
      ),
    );

    expect(html).toContain("Actions");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("renders alert dialog actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AlertDialog,
        null,
        React.createElement(AlertDialogTrigger, null, "Delete"),
        React.createElement(
          AlertDialogContent,
          { forceMount: true },
          React.createElement(
            AlertDialogHeader,
            null,
            React.createElement(AlertDialogTitle, null, "Delete item"),
          ),
          React.createElement(AlertDialogDescription, null, "This cannot be undone."),
          React.createElement(
            AlertDialogFooter,
            null,
            React.createElement(AlertDialogCancel, null, "Cancel"),
            React.createElement(AlertDialogAction, null, "Continue"),
          ),
        ),
      ),
    );

    expect(html).toContain("Delete");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("renders a scroll area viewport", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ScrollArea,
        { className: "h-20" },
        React.createElement("div", null, "Scrollable content"),
        React.createElement(ScrollBar, { orientation: "horizontal" }),
      ),
    );

    expect(html).toContain("Scrollable content");
    expect(html).toContain('data-slot="scroll-area"');
  });

  it("renders separator semantics", () => {
    const html = renderToStaticMarkup(React.createElement(Separator, { decorative: false }));

    expect(html).toContain('role="separator"');
    expect(html).toContain('data-orientation="horizontal"');
  });

  it("renders command input and options", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Command,
        null,
        React.createElement(CommandInput, { placeholder: "Search tools" }),
        React.createElement(
          CommandList,
          null,
          React.createElement(CommandEmpty, null, "No results."),
          React.createElement(
            CommandGroup,
            { heading: "Tools" },
            React.createElement(
              CommandItem,
              { value: "quote" },
              "Quote",
              React.createElement(CommandShortcut, null, "⌘K"),
            ),
          ),
        ),
      ),
    );

    expect(html).toContain('placeholder="Search tools"');
    expect(html).toContain('role="option"');
    expect(html).toContain("⌘K");
  });

  it("renders chart helpers", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ChartContainer,
        { config: { value: { label: "Value", color: "hsl(var(--tw-accent))" } } },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ChartTooltip, {
            content: React.createElement(ChartTooltipContent),
          }),
          React.createElement(ChartTooltipContent, {
            active: true,
            payload: [
              { dataKey: "value", name: "Value", value: 42, color: "hsl(var(--tw-accent))" },
            ],
          }),
        ),
      ),
    );

    expect(html).toContain('data-slot="chart"');
    expect(html).toContain("--color-value");
    expect(html).toContain("Value");
    expect(html).toContain("42");
  });
});
