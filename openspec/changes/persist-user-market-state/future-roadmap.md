# Future Roadmap — User Market State

This document preserves deferred feature context so V1 can stay focused without losing the larger product direction.

## V2 Candidates

- **In-process heartbeat alerts**
  - Evaluate due alert rules while the GUI/TUI writer process is running.
  - Ensure only the active writer evaluates due rules.
  - Surface "checked while OC is open" status distinctly from manual-only rules.

- **Richer alert authoring**
  - Convert watchlist target/stop metadata into explicit alert rules.
  - Add rule templates for RSI oversold/overbought, price crossing SMA, SMA crossovers, volume spikes, and percent moves.
  - Add pause/resume, duplicate, cooldown editing, and event detail views.

- **Bulk watchlist workflows**
  - Paste comma-separated tickers.
  - Resolve candidates in batch.
  - Skip/replace/confirm ambiguous rows.
  - Bulk tag/remove/create alerts.

- **Report configuration improvements**
  - Configure report sections.
  - Include alert summary, technical snapshot, and optional news/sentiment sections.
  - Add report history filtering and export.

- **Import reconciliation UI**
  - Build an Imports/Sources page that previews import batches.
  - Resolve unmatched symbols.
  - Show duplicates and choose skip/update/merge.
  - Display import summaries: added, skipped, failed, needs review.

## V3 Candidates

- **External scheduler integration**
  - Support cron/launchd/systemd/Codex automation for morning reports and alert checks.
  - Clearly label rules checked by an external scheduler.

- **Platform import adapters**
  - TradingView watchlist import.
  - Interactive Brokers portfolio import or sync.
  - Generic broker CSV import.
  - Preserve row-level provenance and source account references without storing broker credentials unless a later credential spec allows it.

- **Multiple watchlists and portfolios**
  - Named collection management.
  - Default switching.
  - Copy/move items between watchlists.
  - Per-report fixed targets by collection id.

- **Accounts and tax-lot depth**
  - Account entities.
  - Real lots, closed lots, realized P&L, and tax-lot history.
  - Account-level allocation and performance views.

- **Delivery channels**
  - Desktop notifications.
  - Email or webhook delivery.
  - Chat/mobile delivery adapters such as Telegram or WhatsApp.
  - Per-alert/report delivery preferences.

## Explicitly Deferred From V1

- Import adapters and import reconciliation UI.
- Continuous or minute-level background alert monitoring.
- Broker credential storage and account sync.
- Executable trading or order placement.
- Multiple named watchlists/portfolios beyond schema readiness.
- Tax-lot accounting and realized P&L.
