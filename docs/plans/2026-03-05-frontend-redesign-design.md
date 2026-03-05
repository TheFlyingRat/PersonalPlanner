# Frontend Redesign — Design Document

**Date:** 2026-03-05
**Direction:** Refined Minimal ("Swiss Precision meets Linear")
**Inspiration:** Linear, Cal.com
**Theme:** System preference (prefers-color-scheme), light + dark
**Scope:** Full redesign — all 8 pages + layout + design system

---

## Design System

### Typography

**Font Family:** Geist Sans + Geist Mono (by Vercel)
- Install via npm: `npm install geist` or load from CDN
- Headings: Geist Sans, weight 600
- Body: Geist Sans, weight 400
- Numbers/times/durations: Geist Mono (monospace)
- Import in app.html via `<link>` tags from CDN:
  - `https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.css`
  - `https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.css`

### Color Tokens (CSS Custom Properties)

Define in `app.css` using `@media (prefers-color-scheme)`:

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-bg` | `#FAFAFA` | `#0C0C0E` | Page background |
| `--color-surface` | `#FFFFFF` | `#16161A` | Cards, panels, sidebar |
| `--color-surface-hover` | `#F4F4F5` | `#1C1C22` | Hover states |
| `--color-surface-active` | `#E4E4E7` | `#27272A` | Active/pressed states |
| `--color-border` | `#E4E4E7` | `#27272A` | Subtle borders |
| `--color-border-strong` | `#D4D4D8` | `#3F3F46` | Emphasized borders |
| `--color-text` | `#09090B` | `#FAFAFA` | Primary text |
| `--color-text-secondary` | `#71717A` | `#A1A1AA` | Muted/secondary text |
| `--color-text-tertiary` | `#A1A1AA` | `#52525B` | Placeholder, disabled |
| `--color-accent` | `#6366F1` | `#818CF8` | Primary accent (indigo) |
| `--color-accent-hover` | `#4F46E5` | `#6366F1` | Accent hover |
| `--color-accent-muted` | `#EEF2FF` | `#1E1B4B` | Accent background tint |
| `--color-accent-text` | `#FFFFFF` | `#FFFFFF` | Text on accent |
| `--color-danger` | `#EF4444` | `#F87171` | Destructive actions |
| `--color-danger-muted` | `#FEF2F2` | `#450A0A` | Danger background |
| `--color-success` | `#10B981` | `#34D399` | Success states |
| `--color-success-muted` | `#ECFDF5` | `#052E16` | Success background |

### Event Type Colors

Each event type uses a subtle fill + left-border accent:

| Type | `--bg` (light) | `--bg` (dark) | `--border` |
|------|----------------|---------------|------------|
| Habit | `#ECFDF5` | `#052E16` | `#10B981` |
| Task | `#EFF6FF` | `#172554` | `#3B82F6` |
| Meeting | `#F5F3FF` | `#1E1338` | `#8B5CF6` |
| Focus | `#FFFBEB` | `#422006` | `#F59E0B` |
| External | `#F4F4F5` | `#27272A` | `#A1A1AA` |

### Spacing Scale

Base: 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96

### Border Radius

- `--radius-sm`: 4px (inputs, small elements)
- `--radius-md`: 6px (buttons, badges)
- `--radius-lg`: 8px (cards, panels)
- `--radius-xl`: 12px (modals, large containers)
- `--radius-full`: 9999px (pills, avatars)

### Shadows

- Light mode only (none in dark mode):
  - `--shadow-sm`: `0 1px 2px rgba(0,0,0,0.05)`
  - `--shadow-md`: `0 2px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`
- Dark mode: use borders for elevation instead of shadows

### Transitions

- `--transition-fast`: `150ms ease`
- `--transition-base`: `200ms ease`
- `--transition-slow`: `300ms ease`

### Icons

- **Library:** Lucide (via `lucide-svelte` npm package)
- **Size:** 16px for inline, 20px for navigation/actions
- **Stroke width:** 1.5
- **NO emojis** — replace all emoji nav icons with Lucide SVGs

---

## Layout & Navigation

### Sidebar (Collapsible)

- Width: 240px expanded, 48px collapsed
- Same background as content (`--color-surface`), separated by right border
- Toggle: button at bottom or keyboard shortcut
- Sections separated by 1px `--color-border` dividers

**Structure:**
```
[R logo]  Reclaim               [« collapse]
─────────────────────────────────
  [Search icon]  Search...         ⌘K
─────────────────────────────────
  [Calendar]     Dashboard
  [Repeat]       Habits
  [CheckSquare]  Tasks
  [Users]        Meetings
  [Target]       Focus Time
─────────────────────────────────
  [Link]         Links
  [BarChart3]    Analytics
─────────────────────────────────
  [Settings]     Settings
```

**States:**
- Default: `--color-text-secondary` text, no background
- Hover: `--color-surface-hover` background
- Active: `--color-accent-muted` background, `--color-accent` text, `--color-accent` left border (2px)

### Mobile

- Sidebar becomes slide-over overlay (from left)
- Hamburger button in top-left
- Backdrop overlay on open

### Content Area

- Top bar: page title (left), contextual actions (right)
- Max content width: none (fill available space)
- Padding: 24px on desktop, 16px on mobile

---

## Page Designs

### Dashboard (Calendar Week View)

**Header:**
- Page title "Schedule" (left)
- Date range label: "Mar 2 – 8, 2026" in `--color-text-secondary`
- Navigation: `←` prev, "Today" pill button (accent outline), `→` next (right side)

**Calendar Grid:**
- Day headers: short day name + date number, today highlighted with accent dot
- Time column: 7:00 AM – 11:00 PM, labels in `--color-text-tertiary`, Geist Mono
- Hour rows: 60px height, separated by hairline `--color-border` rules
- Today column: subtle `--color-accent-muted` background tint
- Current time: thin `--color-accent` horizontal line with small circle indicator

**Events:**
- Rounded rectangles (6px radius)
- Left border: 3px solid event-type color
- Background: event-type muted color
- Title: medium weight, truncated with ellipsis
- Time: Geist Mono, small, `--color-text-secondary`
- Hover: slight border-color intensification
- Click: opens detail in a slide-over panel (right side, 400px wide)
- Overlapping events: side-by-side columns (existing algorithm, keep it)

**All-day events:** Horizontal bar row above time grid

**Legend:** Small inline chips at bottom-right (dot + label), using `--color-text-tertiary`

### CRUD Pages (Habits, Tasks, Meetings, Links)

All follow the same **List + Slide-over** pattern:

**Empty State:**
- Centered vertically
- Icon (muted, 48px) + headline + description + CTA button
- Example: [Repeat icon] "No habits yet" / "Create your first habit to start scheduling" / [+ Add Habit] button

**List View:**
- Clean table-like rows (not cards)
- Each row: left-aligned content columns + right-aligned action icons (appear on hover)
- Row hover: `--color-surface-hover` background
- Row click: opens slide-over with details/edit form
- Header row with column labels in `--color-text-tertiary`, uppercase, small, Geist Mono, letter-spaced

**Status Badges:**
- Small pills (6px radius-full, small padding)
- Muted background + matching text color
- Priority: P1 (red-muted), P2 (orange-muted), P3 (blue-muted), P4 (gray-muted)

**"Add New" Button:**
- Top-right of list
- Accent color pill button: `[+ Add Habit]`
- Opens slide-over panel from right

**Slide-over Panel (replaces modals):**
- 420px wide, slides from right edge
- Header: title + close button (X icon)
- Form fields: label above input, 16px gap between fields
- Input styling: `--color-surface` background, `--color-border` border, `--radius-sm` corners
- Focus state: `--color-accent` border, `--color-accent-muted` ring
- Grouped sections: separated by 1px `--color-border` with 24px padding
- Footer: sticky bottom with "Save" (accent) and "Cancel" (ghost) buttons
- Backdrop: semi-transparent overlay, click to close

**Habits-specific:**
- Enabled/disabled toggle switch (accent when on)
- Lock icon indicator
- Frequency badge

**Tasks-specific:**
- Progress bar: thin (4px), `--color-accent` fill on `--color-border` track
- Status dropdown: Open / Done Scheduling / Completed
- "Up Next" toggle badge
- Duration: "X/Y min" in Geist Mono

**Meetings-specific:**
- Attendee avatars (initials circles)
- Conference type badge

**Links-specific:**
- Slug display in Geist Mono
- "Copy URL" button with checkmark feedback
- Enabled/disabled toggle

### Settings Page

**Layout:** Single column, grouped sections with clear headings

**Sections:**

1. **Google Account**
   - Connection status badge (green dot + "Connected" or red dot + "Disconnected")
   - Connect/Disconnect button (outline style)

2. **Calendars** (only when connected)
   - "Refresh" button (outline, with sync icon)
   - Table: Color dot | Name | Mode dropdown | Enable toggle
   - Default calendar dropdowns for habits/tasks below

3. **Working Hours**
   - Two time inputs side by side: Start — End
   - Clean label above

4. **Personal Hours**
   - Same as working hours layout

5. **General**
   - Timezone: text input
   - Scheduling window: number input + "days" label

6. **Buffers**
   - Three number inputs: Travel, Decompression, Break
   - Dropdown: Apply decompression to (All / Video Only)

**Save button:** Sticky bottom bar, full-width accent button. States: idle / saving (spinner) / saved (checkmark, auto-dismiss)

### Analytics Page

**Summary Cards (top row, 4 cards):**
- Each: icon (muted) + label (small, secondary) + value (large, Geist Mono, bold)
- Habit Hours, Task Hours, Meeting Hours, Focus Hours
- Subtle border, no shadow in dark mode

**Habit Completion (mid section):**
- Clean SVG ring chart (accent color fill, border track)
- Percentage in center (Geist Mono, large)
- Label below

**Weekly Summary:**
- Simple grid: Total Hours, Avg/Workday, Top Category
- Clean borders, aligned values

**Daily Breakdown Chart:**
- Horizontal stacked bars (one per day)
- Muted event-type colors
- Labels in Geist Mono
- Minimal gridlines, clean axis labels

### Focus Time Page

**Configuration Panel:**
- Enable toggle at top
- Weekly target: number input + "minutes"
- Daily target: number input + "minutes"
- Scheduling hours dropdown

**Progress Section:**
- Circular SVG progress ring (accent color)
- Percentage in center (Geist Mono)
- "X / Y hours this week" below in secondary text

**Daily Breakdown:**
- Simple horizontal bar chart
- One bar per day of the week
- Labels in secondary text

---

## Implementation Notes

### Package Changes
- Install: `lucide-svelte` (icons)
- Geist fonts via CDN links in app.html (no npm install needed)

### File Changes
1. `app.html` — add Geist font CDN links
2. `app.css` — complete rewrite with CSS custom properties and dark mode
3. `+layout.svelte` — redesign sidebar with Lucide icons
4. `+page.svelte` (dashboard) — redesign calendar
5. `habits/+page.svelte` — redesign to list + slide-over
6. `tasks/+page.svelte` — redesign to list + slide-over
7. `meetings/+page.svelte` — redesign to list + slide-over
8. `links/+page.svelte` — redesign to list + slide-over
9. `settings/+page.svelte` — redesign to grouped sections
10. `analytics/+page.svelte` — redesign with clean charts
11. `focus/+page.svelte` — redesign with progress ring

### Component Strategy
- No shared component library extraction (YAGNI for 8 pages)
- Consistent patterns via CSS classes defined in app.css
- Each page remains self-contained

### Accessibility
- All interactive elements: visible focus rings (accent color)
- Color contrast: 4.5:1 minimum
- Touch targets: 44x44px minimum
- `prefers-reduced-motion`: disable transitions
- Semantic HTML: proper headings hierarchy, labels, aria attributes
- Keyboard navigation: tab order, Escape to close panels
