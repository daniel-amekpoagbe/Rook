---
name: Rook
description: A zero-knowledge personal vault with the calm, exact surface of a production password manager.
colors:
  canvas: "#f4f5f7"
  surface: "#ffffff"
  surface-sunken: "#f9fafb"
  surface-raised: "#f2f4f7"
  ink: "#111318"
  ink-secondary: "#5a6270"
  ink-tertiary: "#667085"
  hairline: "#e4e7ec"
  hairline-strong: "#d0d5dd"
  action-blue: "#1b6ef3"
  action-blue-hover: "#1459c9"
  action-blue-wash: "#eaf1fe"
  success-green: "#067647"
  caution-amber: "#b54708"
  danger-red: "#b42318"
typography:
  display:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
  code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: 1.5
  small:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
  subhead:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  display-lg:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
rounded:
  control: "8px"
  tile: "10px"
  panel: "12px"
  overlay: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "32px"
---

# Design System: Rook

## Overview

**Creative North Star: "The Quiet Vault"**

Rook should feel like the desk of a careful records clerk: cool gray chrome, white work surfaces, hairline rules, and exactly one confident blue that appears only where something can be done. It is a three-pane password manager with the density of a desktop tool: navigation, list, and detail. The name and mark are a chess rook — a quiet, watchful castle — so the identity is monochrome and geometric, never a mascot.

The interface is quiet by default and precise in the details. Density is closer to a desktop tool than a marketing page: 13–14px body text, 52px list rows, 34px controls, generous padding inside a tight frame. Color is functional — blue for action and selection, red for danger, amber for caution, green for healthy state. Nothing glows. Depth comes from a hairline border at rest; the 1px resting shadow marks small cards and controls, while the overlay shadow is reserved for surfaces that genuinely float.

**Key Characteristics:**
- Three-pane vault: navigation rail, item list, item detail.
- One accent (action blue), used sparingly and never decoratively.
- Hairline borders and tonal surfaces instead of gradients or glow.
- Inter for everything readable; JetBrains Mono only for secrets, codes, domains, and identifiers.
- Dark mode keeps the same roles with its own tokens, not a different personality.

## Colors

A restrained, cool-neutral system with a single blue voice.

### Primary
- **Action Blue** (#1b6ef3): primary buttons, selected navigation, links, focus rings, and the active state of a toggle. If a control cannot be pressed or chosen, it does not get this color.
- **Pressed Blue** (#1459c9): hover and active state for primary actions.
- **Blue Wash** (#eaf1fe): selected list rows, selected filter chips, and the quiet backing of the copy affordance.

### Neutral
- **Cool Canvas** (#f4f5f7): the application ground behind the three panes.
- **Work Surface** (#ffffff): the list pane, detail pane, inputs, and floating overlays.
- **Sunken Surface** (#f9fafb): navigation rail, table headers, read-only field groups.
- **Raised Surface** (#f2f4f7): hovered rows, segmented control tracks, subtle wells.
- **Ink** (#111318): headings and primary values.
- **Secondary Ink** (#5a6270): descriptions, subtitles, field labels.
- **Tertiary Ink** (#667085): timestamps, placeholders, metadata. It passes AA on Sunken and Raised surfaces.
- **Hairline** (#e4e7ec): every resting border and divider.
- **Strong Hairline** (#d0d5dd): input borders on hover and the edge of a floating surface.

### Support
- **Healthy Green** (#067647): saved state and audit passes.
- **Caution Amber** (#b54708): weak passwords, missing 2FA, saving state.
- **Danger Red** (#b42318): destructive actions and failed unlocks.

**The One Voice Rule.** Blue appears only on actionable or selected elements. It is never used for decoration, headings, or large backgrounds; its rarity is what makes the next action obvious.

### Dark Theme
The dark theme keeps the same roles and swaps the tokens:

| Role | Dark |
| --- | --- |
| Canvas | `#0d0f12` |
| Work surface | `#15181c` |
| Sunken surface | `#111418` |
| Raised surface | `#1b1f25` |
| Ink | `#eef1f5` |
| Secondary ink | `#a2abb8` |
| Tertiary ink | `#8b95a5` |
| Hairline | `#262b32` |
| Action blue | `#4f8cff` |
| On action | `#0b1220` |
| Healthy green | `#3ccb7f` |
| Caution amber | `#f5a524` |
| Danger red | `#ff6b5e` |

## Typography

**Display Font:** Inter Variable (with Inter, system-ui fallback)
**Body Font:** Inter Variable (same stack)
**Label / Mono Font:** JetBrains Mono Variable (with ui-monospace fallback)

**Character:** Inter keeps the product familiar and legible at small sizes; JetBrains Mono marks values that must be read character by character — passwords, TOTP codes, hashes, domains, and identifiers. Type weight, not color, carries hierarchy.

### Hierarchy
- **Display** (600, 32px/1.15, -0.03em): the lock-screen statement and first-run moments only; 28px when space is tight.
- **Headline** (600, 22px/1.25, -0.015em): item title in the detail pane.
- **Pane title** (600, 14px/1.4, -0.01em): pane headers and overlay titles. List item titles are 13px medium.
- **Body** (400, 13.5px/1.55): field values, descriptions, form text. Measure stays under 75ch.
- **Small** (400, 12px/1.5): helper text, list subtitles, metadata.
- **Label** (500, 11px/1.2, 0.04em, uppercase): navigation group labels and type chips only. Field labels are sentence case at 11.5px.

**The Monospace Rule.** Mono is a measurement tool, not a costume: use it for secrets, codes, versions, and domains, never for ordinary labels or body copy.

## Layout

A fixed three-pane desktop shell: 244px navigation rail, 336px item list, and a fluid detail pane. Every pane owns its own scroll; the page itself never scrolls. Top bars are 56px; list rows are 52px; buttons are 34px tall (36px on touch), inputs 36px. Spacing follows a 4px base with 8/12/16/24/32 steps. Content in the detail pane is capped at 660px and centered within the pane's 24px gutters.

Below 1024px the rail becomes a drawer; below 768px the list and detail swap as full-width views. The lock screen is a two-column split above 1024px and a single column below it.

**The One Scroll Rule.** The document does not scroll while the vault is open. Panes scroll independently so the search field and primary actions never leave the screen.

## Elevation & Depth

Depth is structural, not ambient. Resting panes are flat with a 1px hairline border. Small cards, fields, and controls may carry the 1px resting shadow; floating surfaces use the Overlay shadow. Shadows always carry a small vertical offset plus a soft blur. There are no glows, no colored halos, and no blurred background decoration.

### Shadow Vocabulary
- **Resting** (`0 1px 2px rgb(16 24 40 / 0.05)`): selected nav item, fields, buttons, and small cards.
- **Floating** (`0 8px 24px -6px rgb(16 24 40 / 0.14), 0 2px 6px -2px rgb(16 24 40 / 0.06)`): dropdown menus and the generator popover.
- **Overlay** (`0 24px 48px -12px rgb(16 24 40 / 0.24)`): modals and the settings/audit sheet.

**The One Edge Rule.** A resting pane gets a border or a shadow, never both. Small cards, fields, and controls may pair the hairline with the 1px resting shadow; floating surfaces switch to the Overlay shadow. Never stack a hairline, a resting shadow, and a second border.

## Shapes

Controls use an 8px radius, tiles and avatars 10px, panels and modals 12–14px. Pills are reserved for counts, status dots, and segmented toggles; ordinary buttons are rounded rectangles. Borders are always 1px. Icons are Lucide via `react-icons`, 16px in controls, 18–24px in empty states, drawn at 1.75 stroke width.

**The Squircle Rule.** Nothing in the vault is a pill except a count or a toggle. Large radii on ordinary controls read as consumer software, not a records tool.

## Brand Mark

The Rook mark is a solid chess rook drawn in three separated, rounded pieces: crown, neck, and base. It is the only non-Lucide mark in the product, reserved for identity and never used as a generic icon.

- In the interface, place it in a white 10px-radius tile with a hairline border and the resting shadow; the mark itself is `#0a0b0e` at 15–21px.
- Keep it monochrome. Do not tint it with Action Blue, add a second color, outline it, or stretch it.
- The favicon uses the same mark on a white rounded square, so the browser tab and the in-app mark read as one object.
- A tiny creature, if ever used for a launch or empty state, must stay line-art and optional; the rook alone is the brand.

## Components

### Buttons
- **Shape:** 8px radius, 34px height, 12px horizontal padding, 13px medium label.
- **Primary:** Action Blue ground, white label, used once per view for the single most likely action.
- **Secondary:** white ground, hairline border, ink label; hover raises the border to Strong Hairline and the ground to Sunken Surface.
- **Quiet:** no border or ground at rest, secondary ink; hover gets Raised Surface.
- **Danger:** white ground with danger text and a danger-tinted border; fills only on confirm.
- **Focus:** 2px blue outline offset 2px; never removed.

### Inputs / Fields
- **Style:** white ground, 1px hairline, 8px radius, 36px height, 13px text; placeholder in Tertiary Ink.
- **Focus:** border turns Action Blue and a 4px Blue Wash ring appears.
- **Error:** danger border plus a 12px message below the field.

### Navigation
- **Rail:** Sunken Surface, 244px. Group labels are 11px uppercase in Tertiary Ink. Items are 32px tall with 16px icons, 8px radius, count on the right in tabular numerals.
- **Active:** white ground, hairline border, Resting shadow, ink label, blue icon.
- **List:** white ground. Selected row is Blue Wash with ink title and the tinted monogram; hover is Raised Surface. No left accent bars.

### Chips
- **Style:** 10px uppercase, 0.06em tracking, 1px hairline, 6px radius, Sunken Surface.
- **Use:** entry type, metadata, and filter counts only.

### Overlays
- **Modal:** centered, 12px radius, Overlay shadow, 56px header with a hairline divider.
- **Sheet:** right-anchored, 480px, full height, 1px left hairline, Overlay shadow, used for audit and settings.
- **Menu:** 8px radius, Floating shadow, 6px padding, 32px rows, blue icon on the active row.

### Signature: The Item Row
A 52px row: 36px tinted monogram tile, 15px title, 12px subtitle, optional star. The tint is derived from the item title and kept below 12% saturation so the list never becomes a color chart. Selection is a wash, not a bar.

## Do's and Don'ts

### Do:
- **Do** keep body text at 13–14px and labels at 11–12px; this is a desktop tool, not a landing page.
- **Do** use one blue action per view and let weight and spacing carry the rest of the hierarchy.
- **Do** give every pane a 56px top bar with a hairline divider so the frame reads as a real application.
- **Do** show state in words next to the status dot: "Saved 2m ago", "Saving…", "Conflict".
- **Do** keep empty states useful: explain the state and offer the next action, never a decorative illustration alone.

### Don't:
- **Don't** use gradients, glow, glass, or colored halos anywhere in the vault.
- **Don't** use uppercase field labels or tracked eyebrows over sections.
- **Don't** put a shadow and a border on the same resting card.
- **Don't** use more than three text sizes in a single pane.
- **Don't** use emoji as icons or mix icon families; Lucide is the only set.
