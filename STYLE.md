# Void Operations Terminal UI Style Guide

This document defines the shared look-and-feel for the client terminal UI.
Use it when building new screens and when refactoring old ones.

## 1) Core Principles

- Keep screens readable in narrow terminals.
- Favor consistent structure over novelty.
- Use motion intentionally (status feed, scan reveal, progress) but keep it short.
- Always preserve operator control: every flow must provide a clear back path.

## 2) Page Structure

Standard page flow:

1. `renderHeader(user)` for app chrome
2. `clearContent(4)` before drawing page content
3. Page title in cyan, uppercase style: `── TITLE ──`
4. Primary content
5. `renderLog()` or `renderDroneLog(droneId)`

Layout conventions:

- Left pane = primary content
- Right pane = system log (when enabled)
- Info panel remains bottom-left and should not be manually overdrawn

## 3) Typography & Copy

- Titles: uppercase section framing (`── ... ──`)
- Menu labels: short action verbs (`Travel`, `Scan`, `Rename Drone`)
- Status/error copy: direct and specific
- Keep line length short enough to avoid wrapping into the log pane

Tone:

- Operational and concise
- No playful filler text in core flows
- Placeholders for future features should be explicit: `(Soon)`

## 4) Color System

Global status colors:

- `idle` -> green
- `travelling` -> yellow
- `emergency` -> yellow
- `mining` -> cyan
- `returning` -> blue
- `offline` -> red

Scan target category colors:

- Ships -> cyan
- Stations -> green
- Mining Fields -> yellow
- Current Location -> white
- Unknown/Fallback -> gray

Semantic usage:

- Success -> green
- Warning/transitional -> yellow
- Error/failure -> red
- Metadata/help text -> gray

## 5) Menus

Use `term.singleColumnMenu` with:

- `leftPadding: '  '`
- Consistent selected style per flow
- `← Back` as final option

Rules:

- Action menus should list high-frequency actions first
- Destructive/admin actions should be visually separated when practical
- Confirmation menus required for user-entered mutations (rename, etc.)

## 6) Loading & Progress Patterns

### 6.1 Progress bars

Use `term.progressBar` for deterministic progression:

- Filled: `█`
- Empty: `░`
- Keep width compact (~30-40 columns)
- Avoid long-running blocking animations

### 6.2 Reveal sequences

For scans/status feeds:

- Reveal rows one-by-one with short delays
- Sort by meaningful metric first (distance asc where applicable)
- Keep stagger randomization bounded and subtle

### 6.3 Transition blinks

Allowed for short handoff moments only (e.g. "Booting target menu...")

- Duration target: ~300-700 ms total
- Must not trap input or hide navigation

## 7) Interaction Standards

- Every screen must support immediate return (`← Back`)
- Offline/blocked states should short-circuit to a simple banner + back
- Invalid actions should show both:
  - log entry (`addLog`)
  - immediate local feedback screen when needed

## 8) Data Ordering Rules

- Distance-based lists: ascending (`0` = nearest)
- Grouped scan targets:
  1. Current Location
  2. Ships
  3. Stations
  4. Mining Fields
  5. Other

Within group:

- Primary sort: distance asc
- Secondary sort: label asc

## 9) Implementation Rules (Client)

- New pages live in `client/src/ui/pages/`
- Import UI primitives from `client/src/ui/layout.js` only
- Do not call terminal-kit directly from random modules outside UI layer

When adding a new page function:

1. Implement in page module
2. Export via `client/src/ui/dashboard.js`
3. Call from `client/src/index.js` flow

## 10) Refactor Checklist

When modernizing an old screen, verify:

- Uses standard title framing and spacing
- Calls `clearContent(4)` before draw
- Uses shared color/status mappings
- Includes explicit back path
- Renders log sidebar at end
- Uses consistent loading/reveal pattern (if async)
- Keeps copy concise and operator-focused

