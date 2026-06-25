# TUI/Pi Dogfood Result

Date: 2026-06-25

Prompt:

```text
What is the current price of MSFT? Keep it brief.
```

Result:

- Completed through the Pi/OpenCandle session harness in 4.97s.
- Tool sequence: `get_stock_quote`.
- Final response: `MSFT is currently trading at $354.27, down 3.06% today.`
- The emitted custom entries included `opencandle-fallback-context` and `opencandle-disclaimer`.

Additional bounded TUI startup check:

- `npm start` opened the Pi TUI on branch `gui-concurrent-session-runtime`.
- The TUI resumed an existing AAPL prompt, displayed the `get_stock_quote` tool card, and rendered the answer for `What is the current price of AAPL?`.
- The process was stopped by the local alarm wrapper after rendering the answer; it was not a runtime failure.
