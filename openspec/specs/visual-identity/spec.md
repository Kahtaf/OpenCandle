## Visual Identity

### Requirements

- Logo exists as SVG source and PNG raster in `assets/`
- Logo is legible at 32px (favicon) and 200px (README header)
- Logo uses a candle or candlestick motif consistent with the project name
- Demo videos show the real TUI and local GUI experiences
- README displays poster images in or near the intro that link to the demo videos
- README video links use GitHub blob/raw URLs so the demos are reachable from GitHub and npmjs.com
- `assets/` is NOT included in the npm tarball - `package.json` `files` remains `["dist"]`

### Acceptance

- [ ] `assets/logo.svg` and `assets/logo.png` exist and render correctly
- [ ] `assets/opencandle-tui.mp4` and `assets/opencandle-gui.mp4` exist and show real agent output
- [ ] `assets/opencandle-tui-poster.png` and `assets/opencandle-gui-poster.png` exist and render correctly
- [ ] README renders the poster images on GitHub and links to the demo videos
- [ ] README renders the poster images and video links on npmjs.com (verified after publish or via preview)
- [ ] `npm pack --dry-run` output does NOT include any `assets/` files
