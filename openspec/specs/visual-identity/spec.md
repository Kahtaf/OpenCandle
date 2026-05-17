## Visual Identity

### Requirements

- Logo exists as SVG source and PNG raster in `assets/`
- Logo is legible at 32px (favicon) and 200px (README header)
- Logo uses a candle or candlestick motif consistent with the project name
- Demo GIF shows a real TUI session with at least 2 distinct queries
- Demo GIF is under 5MB
- README displays logo centered, badges below, demo GIF in or near the intro
- README images use absolute GitHub raw content URLs (`https://raw.githubusercontent.com/opencandle/opencandle/main/assets/...`) so they render on both GitHub and npmjs.com
- `assets/` is NOT included in the npm tarball — `package.json` `files` remains `["dist"]`

### Acceptance

- [ ] `assets/logo.svg` and `assets/logo.png` exist and render correctly
- [ ] `assets/demo.gif` exists, is under 5MB, and shows real agent output
- [ ] README renders the logo and GIF on GitHub using absolute raw URLs
- [ ] README renders the logo and GIF on npmjs.com (verified after publish or via preview)
- [ ] `npm pack --dry-run` output does NOT include any `assets/` files
