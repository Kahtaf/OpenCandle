## Visual Identity

### Requirements

- Logo exists as SVG source and PNG raster in `assets/`
- Logo is legible at 32px (favicon) and 200px (README header)
- Logo uses a candle or candlestick motif consistent with the project name
- Demo videos show the real TUI and local GUI experiences
- README displays the demo videos in or near the intro
- README media use absolute GitHub raw content URLs (`https://raw.githubusercontent.com/Kahtaf/opencandle/main/assets/...`) so they render on both GitHub and npmjs.com
- `assets/` is NOT included in the npm tarball - `package.json` `files` remains `["dist"]`

### Acceptance

- [ ] `assets/logo.svg` and `assets/logo.png` exist and render correctly
- [ ] `assets/opencandle-tui.mp4` and `assets/opencandle-gui.mp4` exist and show real agent output
- [ ] README renders the logo and demo videos on GitHub using absolute raw URLs
- [ ] README renders the logo and demo videos on npmjs.com (verified after publish or via preview)
- [ ] `npm pack --dry-run` output does NOT include any `assets/` files
