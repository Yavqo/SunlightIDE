---
version: alpha
name: SunlightIDE
description: A desktop code editor with flat surfaces, compact tabs and one blue accent.
colors:
  primary: "#0064E0"
  ink: "#1C2B33"
  muted: "#5D6C7B"
  canvas: "#FFFFFF"
typography:
  sans:
    fontFamily: "Plus Jakarta Sans"
  mono:
    fontFamily: "Geist Mono"
rounded:
  tab: "10px"
spacing:
  tabbar-height: "44px"
components:
  editor-group: {}
  tab: {}
  sash: {}
  toast: {}
---

# SunlightIDE Design System

## Overview

### Creative North Star

A calm workbench: code occupies the available space, with compact controls at its edges.

### Product context and register

Developers editing local projects in Electron. The existing interface is English;
no particular geographic market is assumed. Daily desktop use favors information
density, readable code and predictable keyboard interaction. Preserve the existing
Yavqo visual identity rather than introducing a new style for individual features.

Runtime tokens are owned by `src/renderer/styles.css`; this document records their
intent. Extension themes map through `src/renderer/ext/theme.js`. No independent
palette or generated token copy is introduced for split editors.

## Colors

Reuse `--bg`, `--editor-bg`, `--line`, `--fg`, `--fg-muted` and `--link` for both light
and dark themes. The focused editor group uses the existing accent at the tab-strip
boundary and exposes its identity through focus commands and accessible group labels.

## Typography

Plus Jakarta Sans serves controls and Geist Mono serves code. Retain existing font
sizes, line heights and syntax colors across editor groups.

## Layout

One workbench shares a sidebar and terminal. The code area supports one or two
side-by-side groups. Each group owns a tab strip, editor, search and page host.
Tab strips scroll horizontally. A divider resizes the groups between 25% and 75%;
both sides shrink without forcing the workbench beyond the window.

## Elevation & Depth

Use existing flat surfaces and hairline boundaries. Search, completion and hover
popups retain their existing elevation; panes do not add decorative shadows.

## Shapes

Reuse existing rounded tabs and controls. Editor groups and the divider are square
structural regions, not nested cards.

## Components

Editor-group state belongs to `src/renderer/editor/groups.js`. Pane construction
and binding in `src/renderer/app.js` reuse Editor, FindWidget, Minimap, PageHost and
LanguageIntelligence. Resizing reuses `makeSash` with keyboard and reset actions.

## Motion

Retain existing transitions and reduced-motion rules. Divider dragging updates
layout directly, without interpolating widths or introducing autonomous animation.

## Accessibility

Groups and tab lists have accessible names. Tabs support keyboard activation and
arrow navigation; pane focus and tab movement have command-palette alternatives.
The divider supports arrows and Home, with a visible focus ring and value metadata.
Closing a shared view retains its edits; closing the last dirty view uses the existing
save prompt. Joining groups preserves every open document.
