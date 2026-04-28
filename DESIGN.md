---
name: Nexu Design System
description: Desktop-first AI bot platform UI — teal brand, clean surfaces, fluid micro-interactions
version: "2.0"
source: apps/web/src/index.css
---

# Nexu Design System

## Brand Identity

Nexu's visual language is **calm, professional, and trustworthy** — an interface for power users who live in it daily. The palette is anchored by a teal brand color (`#3db9ce`) that conveys clarity and intelligence without aggression. The overall feel is "high-end SaaS dashboard with a human touch" — not corporate-grey bland, not playful-startup loud. Surfaces are clean and airy; motion is purposeful rather than decorative.

---

## Color

### Brand

| Token                  | Hex       | Use                                  |
|------------------------|-----------|--------------------------------------|
| `--color-brand-primary`  | `#3db9ce` | Primary actions, highlights, links   |
| `--color-brand-subtle`  | `rgba(61,185,206,0.08)` | Tag backgrounds, subtle accents |

The teal brand primary is used sparingly — active states, focus rings, the breathing border animation, and brand-colored tags. The 10% opacity subtle variant is for large-area backgrounds that should hint at brand without overwhelming.

### Neutral Palette

| Token                 | Hex       | Use                              |
|-----------------------|-----------|----------------------------------|
| `--color-neutral-0`     | `#ffffff` | Pure white                       |
| `--color-neutral-50`    | `#f9f9f9` | Near-white                       |
| `--color-neutral-100`   | `#f3f3f3` | Light grey                       |
| `--color-neutral-200`   | `#eeeeee` | Borders on light backgrounds     |
| `--color-neutral-300`   | `#d4d4d4` | Disabled text, dividers           |
| `--color-neutral-400`   | `#909599` | Placeholder text                 |
| `--color-neutral-500`   | `#787c80` | Muted / tertiary text            |
| `--color-neutral-600`   | `#6c7073` | Secondary text                   |
| `--color-neutral-700`   | `#545659` | Body text                        |
| `--color-neutral-800`   | `#222b39` | Dark navy — not black            |
| `--color-neutral-900`   | `#042028` | Deep teal-black for headings     |

### Surface

| Token                 | Hex       | Use                              |
|-----------------------|-----------|----------------------------------|
| `--color-surface-0`    | `#fafafa` | Page background                  |
| `--color-surface-1`    | `#ffffff` | Cards, panels, modals            |
| `--color-surface-2`    | `#f5f5f5` | Hover state, nav active bg        |
| `--color-surface-3`    | `#eeeeee` | Secondary surfaces, code blocks   |
| `--color-surface-4`    | `#e5e5e5` | Disabled states, scrollbar thumb |
| `--color-surface-5`    | `#d4d4d4` | Borders, separators               |

### Dark Surface

| Token                        | Hex              | Use                        |
|------------------------------|------------------|----------------------------|
| `--color-dark-bg`              | `#0d0d10`        | Dark mode background        |
| `--color-dark-surface`         | `#1a1a1f`        | Dark panels                |
| `--color-dark-surface-hover`   | `#242429`        | Dark hover state           |
| `--color-dark-border`          | `rgba(255,255,255,0.08)` | Dark borders    |

### Warm Surface

| Token                      | Hex       | Use                        |
|----------------------------|-----------|----------------------------|
| `--color-warm-bg`            | `#f7f5ef` | Welcome page background    |
| `--color-warm-surface`       | `#f6f3ec` | Welcome page panels        |
| `--color-warm-surface-hover` | `#f2eee4` | Welcome page hover         |

### Border

| Token                    | Hex             | Use                          |
|--------------------------|-----------------|------------------------------|
| `--color-border-subtle`    | `rgba(0,0,0,0.06)` | Card borders, dividers    |
| `--color-border-strong`    | `rgba(0,0,0,0.12)` | Input borders, separators |
| `--color-border`           | `rgba(0,0,0,0.08)` | Default border             |
| `--color-border-hover`     | `rgba(0,0,0,0.1)`  | Hover border               |
| `--color-border-card`      | `rgba(0,0,0,0.06)` | Card-specific border       |

### Text

| Token                      | Hex       | Use                              |
|----------------------------|-----------|----------------------------------|
| `--color-text-heading`      | `#001217` | Page/section headings (near black with teal tint) |
| `--color-text-primary`      | `#1c1f23` | Body text                        |
| `--color-text-secondary`    | `#545659` | Labels, secondary content        |
| `--color-text-tertiary`     | `#787c80` | Timestamps, placeholders         |
| `--color-text-placeholder`  | `#787c80` | Input placeholders                |
| `--color-text-disabled`     | `rgba(28,31,35,0.38)` | Disabled text              |
| `--color-text-muted`        | `#787c80` | Muted / de-emphasized text       |

### Accent (Primary Button)

| Token                  | Hex       | Use                              |
|------------------------|-----------|----------------------------------|
| `--color-accent`         | `#1c1f23` | Primary button background        |
| `--color-accent-hover`   | `#222b39` | Primary button hover             |
| `--color-accent-subtle`  | `rgba(28,31,35,0.06)` | Hover backgrounds     |
| `--color-accent-glow`   | `rgba(28,31,35,0.12)` | Focus glow            |
| `--color-accent-fg`      | `#ffffff` | Primary button text              |

### Functional

| Token                  | Hex       | Use                              |
|------------------------|-----------|----------------------------------|
| `--color-error`          | `#f8672f` | Error state                      |
| `--color-error-subtle`   | `rgba(248,103,47,0.08)` | Error background    |
| `--color-success`        | `#00a365` | Success / connected state        |
| `--color-success-subtle` | `rgba(0,163,101,0.08)` | Success bg         |
| `--color-success-muted`  | `rgba(0,163,101,0.1)`  | Success muted bg   |
| `--color-success-border`  | `rgba(0,163,101,0.15)` | Success border    |
| `--color-warning`         | `#edc337` | Warning state                    |
| `--color-warning-subtle`  | `rgba(237,195,55,0.08)` | Warning bg        |
| `--color-danger`          | `#f93920` | Danger / failed state            |
| `--color-danger-subtle`   | `rgba(249,57,32,0.08)`  | Danger bg         |
| `--color-link`            | `#2657bb` | Link text                        |
| `--color-info`            | `#2657bb` | Info state                       |
| `--color-info-subtle`     | `rgba(38,87,187,0.08)`  | Info bg           |
| `--color-pink`            | `#d999f7` | Decorative accent (e.g., bot avatar) |

### Toggle

| Token              | Hex       | Use                                    |
|--------------------|-----------|----------------------------------------|
| `--color-toggle-on` | `#007aff` | macOS-style toggle ON state (system blue) |

### shadcn/ui Compatibility

These tokens map the Nexu palette onto the shadcn/ui design token namespace so Radix-based components work correctly alongside native Nexu styles.

| Token                          | Hex     | Maps to                   |
|--------------------------------|---------|---------------------------|
| `--color-background`              | `#fafafa` | `--color-surface-0`        |
| `--color-foreground`              | `#1c1f23` | `--color-text-primary`     |
| `--color-card`                   | `#ffffff` | `--color-surface-1`        |
| `--color-card-foreground`        | `#1c1f23` | `--color-text-primary`     |
| `--color-popover`                | `#ffffff` | `--color-surface-1`        |
| `--color-popover-foreground`     | `#1c1f23` | `--color-text-primary`     |
| `--color-primary`                | `#1c1f23` | `--color-accent`           |
| `--color-primary-foreground`     | `#ffffff` | `--color-accent-fg`       |
| `--color-secondary`              | `#f5f5f5` | `--color-surface-2`        |
| `--color-secondary-foreground`    | `#1c1f23` | `--color-text-primary`     |
| `--color-muted`                  | `#eeeeee` | `--color-surface-3`        |
| `--color-muted-foreground`       | `#545659` | `--color-text-secondary`   |
| `--color-destructive`             | `#f93920` | `--color-danger`           |
| `--color-destructive-foreground` | `#ffffff` | white                      |
| `--color-input`                  | `rgba(0,0,0,0.08)` | `--color-border`   |
| `--color-ring`                   | `#1c1f23` | brand focus ring           |

---

## Typography

### Font Stack

| Token           | Value                                                                                           | Usage                        |
|-----------------|-------------------------------------------------------------------------------------------------|------------------------------|
| `--font-sans`     | `"Digits", "Manrope", "Inter", "PingFang SC", -apple-system, "Noto Sans SC"`                   | Body text, UI                |
| `--font-mono`     | `"JetBrains Mono", "SF Mono", "Fira Code", monospace`                                           | Code blocks, technical text  |
| `--font-heading`  | `"Georgia", "Times New Roman", serif`                                                           | Decorative headings          |
| `--font-script`   | `"Caveat", cursive`                                                                             | Handwritten accents           |

### Digits — Tabular Figures

Nexu defines a custom `Digits` font face that routes digits (`0–9`), punctuation (`. , % + - :`), and their unicode characters through **JetBrains Mono** at **88% size**. This ensures all numbers are tabular (fixed-width) and render crisply in code-adjacent contexts. The face falls back gracefully to local JetBrains Mono if the WOFF2 files are unavailable.

### Heading Styles

| Class                  | Size   | Weight | Line Height | Color                  | Use                       |
|------------------------|--------|--------|-------------|------------------------|---------------------------|
| `.heading-page`         | 24px   | 700    | 1.2         | `--color-text-heading`  | Page titles               |
| `.heading-page-desc`   | 12px   | 400    | 1.4         | `--color-text-tertiary` | Page subtitle / descriptor |
| `.heading-section`     | 14px   | 500    | 1.4         | `--color-text-heading`  | Section headers           |

### Body / Base

- **Base font size:** inherited from Tailwind (default 14–16px depending on element)
- **Line height:** 1.5–1.7 for body, 1.2 for headings
- **Letter spacing:** tight for headings, normal for body
- **Web font rendering:** `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`

---

## Spacing

Nexu uses Tailwind CSS utility classes (spacing scale based on 4px grid). The design system does not define explicit spacing tokens — use Tailwind's `space-*` and `gap-*` utilities alongside `p-*` / `px-*` / `py-*` / `m-*` classes.

| Tailwind class | Value | Typical use                           |
|----------------|-------|---------------------------------------|
| `p-4` / `px-4` | 16px  | Standard card padding                 |
| `gap-2`        | 8px   | Icon + label in nav items             |
| `gap-3`        | 12px  | Chat bubble spacing                   |
| `gap-4`        | 16px  | Section spacing                       |
| `rounded-2xl`  | 16px  | Card border radius                    |
| `py-3` / `px-4` | 12/16px | Input field padding               |

---

## Border Radius

| Token          | Value     | Use                                    |
|----------------|-----------|----------------------------------------|
| `--radius-4`     | 4px      | Badges, small chips                   |
| `--radius-6`     | 6px      | Nav items, inputs                      |
| `--radius-8`     | 8px      | Buttons, dropdowns                     |
| `--radius`       | 8px      | Default radius (matches `--radius-8`)  |
| `--radius-12`    | 12px     | Data tables, wide cards                |
| `--radius-16`    | 16px     | Cards (primary)                        |
| `--radius-20`    | 20px     | Large containers                       |
| `--radius-24`    | 24px     | Wide modals                            |
| `--radius-28`    | 28px     | Very large panels                      |
| `--radius-32`    | 32px     | Full-width panels                      |
| `--radius-pill`  | 100px    | Tags, pills, avatar indicators         |
| `--radius-circle`| 50%      | Avatars, round icons                   |

---

## Shadow

| Token                 | Value                                              | Use                                      |
|-----------------------|----------------------------------------------------|------------------------------------------|
| `--shadow-rest`        | `0 1px 3px rgba(0,0,0,0.04)`                      | Cards at rest                            |
| `--shadow-card`        | `0 4px 8px 0 rgba(0,0,0,0.08)`                    | Elevated cards                           |
| `--shadow-refine`      | `0 10px 20px -5px rgba(0,0,0,0.06)`               | Card hover (lift)                        |
| `--shadow-elevated`    | `0 18px 60px rgba(0,0,0,0.08)`                   | Floating panels, modals                   |
| `--shadow-dropdown`    | `0 8px 24px rgba(0,0,0,0.08)`                    | Dropdown menus                           |
| `--shadow-dropdown-dark` | `0 8px 24px rgba(0,0,0,0.18)`                 | Dropdown menus (dark surface)            |
| `--shadow-overlay`     | `0 18px 38px rgba(0,0,0,0.1)`                     | Overlays, drawers                        |
| `--shadow-m`           | `0 2px 20px 4px rgba(0,0,0,0.04)`                | Subtle mid-lift shadow                   |
| `--shadow-focus`       | `0 0 0 2px rgba(61,185,206,0.25)`               | Brand-colored focus ring (teal)          |
| `--shadow-input-inset` | `inset 0 1px 2px rgba(0,0,0,0.02)`               | Inset input appearance                   |

---

## Motion

### Principles

Motion in Nexu is **purposeful and swift** — it communicates state changes and guides attention, never decorates. Durations are short (150–400ms). Spring-like easing (`cubic-bezier(0.16, 1, 0.3, 1)`) is used for entrance animations to convey responsiveness without harshness.

### Animation Keyframes

| Name             | Description                                                                | Duration  | Easing                           |
|------------------|----------------------------------------------------------------------------|-----------|----------------------------------|
| `fade-in`         | Opacity 0 → 1                                                             | 200ms     | `ease-out`                       |
| `scale-in`        | Scale 0.95 + opacity 0 → scale 1 + opacity 1                              | 250ms     | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `page-enter`      | Slide in from right (12px) + fade                                          | 300ms     | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `fade-in-up`      | Fade + translate up 8px                                                    | 350ms     | `ease-out`                       |
| `float`           | Continuous float up 6px and back                                           | 3s        | `ease-in-out`, infinite          |
| `slide-in-right`  | Slide from right edge                                                     | 250ms     | `ease-out`                       |
| `energy-pulse`    | Subtle opacity pulse 0.7 → 1                                              | 1.5s      | `ease-in-out`, infinite          |
| `nexu-bounce`     | Gentle bounce (translateY -5px → 1px)                                     | 1.2s      | `ease-in-out`, infinite          |
| `nexu-spring-in`  | Scale 0 → 1.15 → 0.95 → 1 (spring overshoot)                             | ~400ms    | Spring bezier                    |
| `dot-fade`        | Loading dot opacity 0.15 → 1 → 0.15                                       | 1.2s      | `ease-in-out`, infinite          |
| `pulse-dot`       | Typing indicator dot: scale 0.6 + opacity 0.4 → scale 1 + opacity 1        | 1.4s      | `ease-in-out`, infinite          |
| `breathe`         | Border color + box-shadow pulse (brand teal)                               | 3s        | `cubic-bezier(0.4, 0, 0.2, 1)`, infinite |

### Animation Classes

| Class                  | Animation       | Duration  | Best for                         |
|------------------------|-----------------|-----------|----------------------------------|
| `.animate-fade-in`      | `fade-in`       | 200ms     | Page load, conditional render    |
| `.animate-scale-in`     | `scale-in`      | 250ms     | Modals, popovers                 |
| `.animate-page-enter`   | `page-enter`    | 300ms     | Page transitions                 |
| `.animate-fade-in-up`   | `fade-in-up`    | 350ms     | Staggered list items             |
| `.animate-float`        | `float`         | 3s        | Decorative / ambient             |
| `.animate-slide-in-right` | `slide-in-right` | 250ms   | Notification, drawer             |
| `.animate-energy-pulse` | `energy-pulse`  | 1.5s      | Live status indicators           |
| `.animate-nexu-bounce`  | `nexu-bounce`   | 1.2s      | Loading skeleton bounce          |
| `.animate-dot-fade`     | `dot-fade`      | 1.2s      | Loading dots (single)            |
| `.animate-breathe`      | `breathe`       | 3s        | Active bot indicator border      |
| `.typing-dot`           | `pulse-dot`     | 1.4s      | Typing indicator (staggered 0.2s) |

### Transitions

| Property    | Duration | Easing                              | Use                           |
|-------------|----------|-------------------------------------|-------------------------------|
| `box-shadow` | 200ms    | `ease`                              | Card hover lift               |
| `transform` | 200ms    | `ease`                              | Card hover lift               |
| `background`| 150ms    | `ease`                              | Nav item hover                |
| `color`     | 150ms    | `ease`                              | Text color transitions        |
| `opacity`   | 200ms    | `ease-out`                          | Fade in/out                   |
| `border-color` | 150ms | `ease`                            | Border hover state            |

---

## Components

### Button

Built with `class-variance-authority` (CVA). Uses the `--color-primary` / `--color-primary-foreground` shadcn tokens.

| Variant      | Appearance                                                                  | Use                              |
|--------------|-----------------------------------------------------------------------------|----------------------------------|
| `default`     | Dark (`#1c1f23`) bg, white text, shadow                                    | Primary actions                   |
| `destructive` | Red (`#f93920`) bg, white text                                            | Delete / dangerous actions       |
| `outline`     | Border `--color-border`, white bg, dark text                               | Secondary actions                |
| `secondary`   | Light grey (`#f5f5f5`) bg                                                  | Less prominent actions           |
| `ghost`       | No bg; hover applies `--color-accent-subtle`                               | Tertiary actions, inline buttons  |
| `link`        | Brand primary color, underline on hover                                     | Inline text links                |

| Size      | Dimensions      | Use                           |
|-----------|-----------------|-------------------------------|
| `default` | h-9, px-4, py-2 | Standard button               |
| `sm`      | h-8, px-3       | Compact / table row buttons   |
| `lg`      | h-10, px-8      | Prominent CTA                 |
| `icon`    | h-9, w-9        | Square icon-only button       |

### Badge

| Variant      | Appearance                                                       | Use                          |
|--------------|------------------------------------------------------------------|------------------------------|
| `default`     | Dark bg (`--color-primary`), white text                          | Default label                |
| `secondary`   | Light grey bg (`--color-secondary`)                              | Subdued label                |
| `destructive` | Red bg (`--color-destructive`)                                   | Error label                  |
| `outline`     | Border only, text inherits color                                  | Outline label                |
| `success`     | Green subtle bg (`--color-success-subtle`), green text          | Status: success              |
| `warning`     | Amber bg (`bg-amber-100`), amber-800 text                        | Status: warning              |

### Switch (Toggle)

macOS Tahoe 26 style — clean track with a white thumb that slides between positions. Uses `--color-toggle-on` (`#007aff`) for the ON state.

| Size      | Track (W×H)    | Thumb              | Thumb Travel |
|-----------|----------------|--------------------|--------------|
| `default` | 50×24px        | 32×20px capsule   | 14px         |
| `sm`      | 38×18px        | 24×14px capsule   | 10px         |
| `xs`      | 28×14px        | 17×11px capsule   | 8px          |

Visual details:
- **ON indicator:** white vertical bar centered in track
- **OFF indicator:** grey hollow circle on right side of track
- **Thumb shadow:** `0 1px 3px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)`

### Card

```css
.card {
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  box-shadow: var(--shadow-rest);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.card:hover:not(.card-static) {
  box-shadow: var(--shadow-refine);
  transform: translateY(-1px);
}
```

Use `.card-static` to suppress the hover lift on cards that are interactive but shouldn't animate (e.g., when inside a scrollable list).

### Tag

| Class            | Appearance                                                           | Use                              |
|------------------|----------------------------------------------------------------------|----------------------------------|
| `.tag`            | Pill shape (`border-radius: 100px`), surface-2 bg, muted text, 11px | Generic label / category tag     |
| `.tag-highlight`  | Small 4px radius, brand-subtle bg, brand-primary text, uppercase     | "NEW", "BETA" style highlights   |

### Navigation Item

| Class            | Appearance                                                           |
|------------------|----------------------------------------------------------------------|
| `.nav-item`       | 7px/10px padding, 13px/500, rounded-6, muted text                    |
| `.nav-item:hover`  | surface-2 bg, primary text                                            |
| `.nav-item-active` | surface-2 bg, primary text, font-weight 600                          |

### Sidebar

| Class              | Appearance                                                            |
|--------------------|-----------------------------------------------------------------------|
| `.sidebar`          | flex-col, surface-0 bg, full height                                   |
| `.sidebar-section`  | 0 8px padding                                                         |
| `.sidebar-vibrancy` | `rgba(255,255,255,0.72)` bg + `saturate(180%) blur(20px)` (macOS glass) |

### Data Table

| Class               | Appearance                                                         |
|---------------------|--------------------------------------------------------------------|
| `.data-table`        | rounded-12, border-subtle, surface-1 bg                           |
| `.data-table-header` | surface-0 bg, 10px/20px padding, uppercase 11px labels             |
| `.data-table-row`    | 12px/20px padding, hover: `rgba(0,0,0,0.015)` bg                  |

### Status Dots

| Class              | Color                  | Use                              |
|--------------------|------------------------|----------------------------------|
| `.status-dot-live`   | `--color-success` (`#00a365`) | Connected / active state   |
| `.status-dot-building` | `--color-warning` (`#edc337`) | Building / pending state |
| `.status-dot-failed` | `--color-danger` (`#f93920`) | Failed / error state        |

### Chat Bubble (Local Chat)

| Element        | Style                                                              |
|----------------|--------------------------------------------------------------------|
| Bot bubble      | Border + surface-1 bg, brand-tinted border-radius (rounded-tl-sm)  |
| User bubble     | surface-3 bg, rounded-tr-sm                                        |
| Avatar (bot)    | 36×36px (h-9 w-9), bot avatar image                                |
| Avatar (user)   | 28×28px, gradient purple/violet, "Me" label                        |
| Text            | 13px, max-width 44rem, break-words                                |
| Image bubble    | Inline image with rounded corners                                  |
| File bubble     | Card with filename, MIME type icon, size                           |
| Typing indicator| 3 dots with `.typing-dot` animation (staggered pulse)              |
| API Key warning | Amber warning card (warm yellow bg, orange border, icon + message) |

---

## Special Effects

### macOS Glass Sidebar (`.sidebar-vibrancy`)

Applies a frosted glass blur to the sidebar:

```css
.sidebar-vibrancy {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}
```

Fallback for non-supporting browsers: solid `--color-surface-1`.

### Panel Variants

**`.panel-dark`** — High-contrast dark panels for overlays:
- `--panel-bg: #1a1a1a`, `--panel-bg-subtle: #242424`
- `--panel-border: rgba(255,255,255,0.08)`, `--panel-text: #ffffff`

**`.panel-warm`** — Warm earth tones for welcome / onboarding screens:
- `--panel-bg: #faf8f5`, `--panel-bg-subtle: #f5f2ed`
- `--panel-border: #e8e4dc`, `--panel-text: #3d3929`
- `--panel-accent: #d4a574`

### GitHub Star Link (`.link-github-star`)

Amber/gold pill button for the GitHub star CTA:
- bg: `rgba(251,191,36,0.12)`, border: `rgba(251,191,36,0.4)`
- text: `#b45309` (dark amber)

### Markdown Preview (`.markdown-preview`)

Full markdown rendering for chat, skill readmes, and bot responses. 13px base, 1.7 line-height. Code blocks use `surface-3` bg with monospace font. Links are blue (`--color-link`). Blockquotes have a left border and `surface-2` background.

Compact variant (`.markdown-preview-compact`) scales everything to 11px for tight contexts like table cells.

### Scrollbar Styling

Custom scrollbar across the whole app (Tailwind `@layer base`):
- Thin (6px) scrollbar thumb
- `scrollbar-color: var(--color-surface-4) transparent`
- `scrollbar-width: thin`

Hide scrollbar utility: `.no-scrollbar` (sets `scrollbar-width: none` and `-webkit-scrollbar: display: none`).

---

## Dark Mode

Nexu's desktop shell uses dark surfaces natively. Dark mode is not a toggle — the shell (`desktop-shell`) and runtime pages use dark/warm panel variants by design. The web app itself operates in light mode. Dark surfaces:

| Token                  | Hex       |
|------------------------|-----------|
| `--color-dark-bg`        | `#0d0d10` |
| `--color-dark-surface`    | `#1a1a1f` |
| `--color-dark-surface-hover` | `#242429` |
| `--color-dark-border`    | `rgba(255,255,255,0.08)` |

---

## Accessibility

- Focus rings use the brand teal `--shadow-focus` (`0 0 0 2px rgba(61,185,206,0.25)`)
- All interactive elements have `cursor: pointer` (explicitly restored in `@layer base`)
- Color contrast ratios meet WCAG AA for body text (`#1c1f23` on `#fafafa`)
- No color as the sole means of conveying information (status dots are paired with text labels)
- `color-scheme: light` declared globally; dark surfaces are component-level variants

---

## Design Intent Summary

> Nexu's interface should feel like a well-crafted developer tool — precise, quiet, and reliable. Not a flashy AI demo, not a corporate enterprise portal. The teal brand color adds warmth and identity at key moments (focus rings, active states, breathing indicators) without dominating the canvas. Motion is fast and purposeful. Surfaces are clean. Every pixel earns its place.
