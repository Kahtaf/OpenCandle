# Visual Identity Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Logo assets
The project MUST provide logo assets as SVG source and PNG raster files in `assets/`, using a candle or candlestick motif that remains legible at favicon and README display sizes.

#### Scenario: Logo assets render at required sizes
- **WHEN** `assets/logo.svg` and `assets/logo.png` are rendered at 32px and 200px widths
- **THEN** the mark remains recognizable and consistent with the OpenCandle name

### Requirement: Demo media in README
The README MUST display poster images near the intro that link to demo videos showing the real TUI and local GUI experiences.

#### Scenario: README media renders
- **WHEN** README is rendered on GitHub or npm preview
- **THEN** the TUI and GUI poster images are visible
- **AND** their links open the corresponding demo videos or download fallbacks

### Requirement: Visual assets excluded from npm package
The package configuration MUST keep `assets/` out of the npm tarball, with package files limited to distributable runtime output.

#### Scenario: Package dry run excludes assets
- **WHEN** `npm pack --dry-run` is executed
- **THEN** no `assets/` files are listed in the tarball output
