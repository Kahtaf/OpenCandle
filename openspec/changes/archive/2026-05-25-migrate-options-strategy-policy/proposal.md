## Why

Options strategy prompts still depend on workflow prompt prose and router corrections for covered-call and protective-put behavior. The prompt-to-policy migration has already proven the replacement path for current-event, filing, retail, asset-compare, single-asset, and macro allocation slices. Options should now get a narrow policy card and answer contract so existing-position option prompts preserve owned-underlying context, catalyst tickers, cost basis, shares, DTE hints, Greeks, liquidity, and strategy-specific risk framing without relying on generic fallback ownership.

## What Changes

- Add an implemented `options_strategy` policy card.
- Activate the `options_strategy` answer contract.
- Keep `placeholder_options_strategy` as the V1 evidence-plan owner.
- Run focused old-vs-current parity for `covered-call-routing` and `protective-put-routing`.
- Remove no workflow prompt behavior. Options workflow prompts remain authoritative for option-chain orchestration and contract ranking.
- Update the parity ledger and migration evidence docs with rollback instructions.
