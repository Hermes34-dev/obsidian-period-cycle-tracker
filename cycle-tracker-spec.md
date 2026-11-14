# Cycle Tracker — Obsidian Plugin Specification

> **For Claude Code:** This document is the full spec for a new Obsidian community plugin. Start from the official sample plugin (https://github.com/obsidianmd/obsidian-sample-plugin), keep the build tooling (TypeScript + esbuild), and implement the milestones in order. Keep `src/core/` free of any `obsidian` imports so it can be unit-tested with plain Node (Vitest). Ask before adding runtime dependencies.

---

## 1. Overview

A private, local-first menstrual cycle tracker for Obsidian. The user logs period flow and PMS symptoms by clicking days on a calendar. The plugin predicts the next period and the fertile/ovulation window, and shows summary statistics on a dashboard.

All data lives in **one Markdown file in the vault** (YAML frontmatter). No network requests.

### Goals
- Click a calendar day to log flow intensity and symptoms.
- Recalculate predictions automatically after any change (including manual edits to the log file).
- Show a dashboard: days until next period, days until next fertile window, average period length, average cycle length.
- Work on desktop and mobile.

### Non-goals (v1)
- Contraception or medical-grade fertility prediction.
- Cloud sync, accounts, telemetry, or any network access.
- Daily-note integration (possible later option, see §11).

---

## 2. Tech stack & project layout

- TypeScript, esbuild (from the sample plugin), Obsidian API.
- Plain DOM via Obsidian helpers (`createEl`, `createDiv`) — no UI framework in v1.
- Vitest for unit tests of `src/core/`.

```
cycle-tracker/
├── manifest.json
├── package.json
├── esbuild.config.mjs
├── styles.css
├── src/
│   ├── main.ts               # Plugin class: lifecycle, commands, ribbon, view registration
│   ├── settings.ts           # Settings interface, defaults, SettingTab
│   ├── data/
│   │   └── LogStore.ts       # Read/write/create the log file; emits change events
│   ├── core/                 # PURE — no obsidian imports
│   │   ├── types.ts          # Entry, Period, Cycle, Prediction, Stats
│   │   ├── dates.ts          # ISO date helpers (parse, addDays, diffDays)
│   │   ├── periods.ts        # Group entries into periods; derive cycles
│   │   └── predict.ts        # Stats + predictions
│   ├── view/
│   │   ├── CycleView.ts      # ItemView: two-panel layout container
│   │   ├── Calendar.ts       # Month grid rendering + navigation
│   │   └── Dashboard.ts      # Stat cards
│   └── modal/
│       └── DayModal.ts       # Log/edit a single day
└── tests/
    ├── periods.test.ts
    └── predict.test.ts
```

`manifest.json`:
```json
{
  "id": "cycle-tracker",
  "name": "Cycle Tracker",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Private, local-first period and cycle tracker with predictions.",
  "author": "Hermes34-dev",
  "isDesktopOnly": false
}
```

---

## 3. Data model — the log file

### 3.1 Location
- Default path: `Cycle Tracker/Cycle log.md` (configurable in settings).
- If the file does not exist when the plugin needs it, create it (and its folder) from the template in §3.3.

### 3.2 Schema (frontmatter)

| Field | Type | Required | Notes |
|---|---|---|---|
| `cycle-log-version` | integer | yes | Schema version. Currently `1`. |
| `entries` | array of Entry | yes | Sorted ascending by `date`. One entry per date. |

**Entry**

| Field | Type | Required | Allowed values / notes |
|---|---|---|---|
| `date` | string | yes | `"YYYY-MM-DD"`, **always quoted** to prevent YAML date coercion. Local calendar date. |
| `flow` | string | no | `spotting` \| `light` \| `medium` \| `heavy`. Omit if no flow. |
| `symptoms` | string[] | no | Lower-case keys from the configured symptom list (see §7). Unknown keys are preserved, not dropped. |
| `note` | string | no | Free text. |
| `bbt` | number | no | *Reserved for v2.* Basal body temperature, °C. |
| `lh` | string | no | *Reserved for v2.* `positive` \| `negative`. |
| `ovulation` | boolean | no | *Reserved for v2.* User-confirmed ovulation day. |

Rules:
- An entry with no `flow`, empty `symptoms`, and no `note` (and no v2 fields) is **deleted**, not stored empty.
- `spotting` is recorded and displayed but **does not start or extend a period** (§5.1).
- The parser must be tolerant: skip malformed entries (log a console warning), never throw and blank the UI.

### 3.3 File template

```markdown
---
cycle-log-version: 1
entries:
  - date: "2026-11-02"
    flow: heavy
    symptoms: [cramps, fatigue]
  - date: "2026-11-03"
    flow: medium
    symptoms: [cramps]
  - date: "2026-11-04"
    flow: light
---

# Cycle log

This file is managed by the **Cycle Tracker** plugin. You can edit the
frontmatter by hand; the plugin will pick up changes automatically.

Do not rename or move this file without updating the path in
Settings → Cycle Tracker.
```

(The example entries are for documentation only — the created file starts with `entries: []`.)

### 3.4 Reading & writing (`LogStore`)
- **Read:** `app.metadataCache.getFileCache(file)?.frontmatter`, falling back to `app.vault.read()` + parse if the cache is not ready.
- **Write:** always via `app.fileManager.processFrontMatter(file, fm => { ... })` (atomic, preserves the body).
- **Upsert by date:** replace the entry with the same `date`, or insert it; keep `entries` sorted.
- **Change detection:** listen to `app.metadataCache.on("changed", file => ...)` filtered to the log path; also handle `vault.on("rename")` and `vault.on("delete")` for the log file. Debounce re-render by ~150 ms.
- Expose `onChange(callback)` so the view re-renders on any change, including manual edits.

---

## 4. UI

### 4.1 View
- Register `CycleView` (`ItemView`, view type `cycle-tracker-view`, icon `droplet` or `calendar-heart`).
- Opens as a main-area tab via ribbon icon and command.
- Layout: CSS grid, two columns — **calendar (left, ~60%) | dashboard (right, ~40%)**.
- Responsive: below ~700 px container width, stack (calendar on top, dashboard below). Use a container query or a `ResizeObserver` toggling a class — not a viewport media query, since panes can be narrow on wide screens.

### 4.2 Calendar (left)
- Header: `‹` previous month · month + year · `›` next month · **Today** button.
- 7-column grid, 6 rows. First day of week configurable (Monday default).
- Days outside the current month are shown dimmed and are clickable.
- Each cell shows the day number and, if present, a small symptom dot.

**Cell states** (CSS classes; a day can have several — render in this priority for background):

| Class | Meaning | Suggested style |
|---|---|---|
| `ct-flow-heavy` / `-medium` / `-light` | Logged flow | Solid fill, intensity by opacity |
| `ct-flow-spotting` | Logged spotting | Small dot or thin border |
| `ct-predicted-period` | Predicted period days | Dashed outline, same hue as flow |
| `ct-ovulation` | Predicted ovulation day | Distinct accent ring |
| `ct-fertile` | Predicted fertile window | Light accent fill |
| `ct-today` | Today | Bold number / underline |
| `ct-has-symptoms` | ≥1 symptom logged | Small dot under the number |

- Use Obsidian CSS variables (`--interactive-accent`, `--background-modifier-hover`, `--text-muted`, etc.) so it respects light/dark themes. Flow colour configurable (default a muted red, e.g. `hsl(350 60% 55%)`).
- Legend under the grid.
- Click a cell → open `DayModal` for that date.
- Predictions are drawn only for dates ≥ today.

### 4.3 Day modal
- Title: formatted date (e.g. "Monday, 2 November 2026").
- **Flow:** segmented buttons — None · Spotting · Light · Medium · Heavy (single select).
- **Symptoms:** checkbox chips from the configured list (§7).
- **Note:** single-line or small textarea.
- Buttons: **Save**, **Clear day** (deletes the entry), **Cancel**.
- Keyboard: Enter saves, Esc cancels.
- Saving calls `LogStore.upsert()`; the view re-renders through the change listener (not manually).

### 4.4 Dashboard (right)
Stack of cards:

1. **Next period** — "in **X** days" (with the date below, e.g. "≈ 3 Dec · ±2 days"). If it is overdue: "**X** days late". During a period: "Day **N** of period".
2. **Fertile window** — "starts in **X** days" (date range below). If it is currently in the window: "Fertile window now · ovulation ≈ in **X** days". If ovulation is predicted for today: "Predicted ovulation today".
3. **Average cycle length** — "**29** days" + small text "based on last N cycles · range 27–31".
4. **Average period length** — "**5** days" + "based on last N periods".
5. **Current cycle** — "Cycle day **N**".
6. Footer disclaimer (always visible, muted text): *"Estimates only. Not a method of contraception or a medical device."*

**Not-enough-data states:**
- 0 periods: "Log your first period to get started."
- 1 period: show period length and cycle day; predictions use the default cycle length (setting) and are labelled **"low confidence"**.
- 2 periods (1 cycle): show everything, labelled "low confidence".
- ≥ 3 cycles: normal confidence.

---

## 5. Calculations (`src/core/`, pure functions)

All dates are ISO strings `YYYY-MM-DD`. Implement `diffDays(a, b)` using `Date.UTC(y, m-1, d)` so the result is unaffected by DST and time zones. Do not use `new Date("YYYY-MM-DD")` (it parses as UTC midnight and shifts the day in some zones).

### 5.1 Periods
```
input: entries (sorted), settings.maxGapDays (default 1)
flowDays = entries where flow ∈ {light, medium, heavy}   // spotting excluded
group flowDays into runs: a new run starts when diffDays(prev, curr) > maxGapDays + 1
period = { start, end, length = diffDays(start, end) + 1 }
```
A period whose `end` is today or yesterday is **ongoing**; still count it for cycle starts, but exclude it from the average period length until it ends.

### 5.2 Cycles
```
for consecutive periods i, i+1:
  cycle = { start: periods[i].start, length: diffDays(periods[i].start, periods[i+1].start) }
```
- Outliers: flag cycles with `length < 15` or `length > 90` (configurable) — show them in the history, exclude them from averages.
- Use the **last N valid cycles** (setting, default 6) for statistics.

### 5.3 Statistics
- `avgCycleLength` = **median** of the last N valid cycle lengths (robust to a single odd cycle). Display rounded to the nearest whole day; keep it unrounded internally.
- `cycleSD` = sample standard deviation of the same set (n ≥ 3; otherwise `null`).
- `cycleRange` = min–max of the same set.
- `avgPeriodLength` = median of the last N completed periods.
- Fallback when there are no cycles: `avgCycleLength = settings.defaultCycleLength` (default 28), `avgPeriodLength = settings.defaultPeriodLength` (default 5).

### 5.4 Predictions
```
lastStart       = start of most recent period
nextPeriodStart = lastStart + round(avgCycleLength)
uncertainty     = cycleSD ? max(1, round(cycleSD)) : 2              // ± days, for display
predictedPeriodDays = [nextPeriodStart, nextPeriodStart + round(avgPeriodLength) - 1]

luteal          = settings.lutealPhaseLength (default 12)
ovulationDay    = nextPeriodStart - luteal
fertileWindow   = [ovulationDay - 5, ovulationDay]
```
- **Which window to show as "next":** compute the window for the current cycle (above). If `fertileWindow.end < today`, roll forward one cycle (`+ round(avgCycleLength)`) for both the ovulation day and the window.
- **Overdue:** if `today > nextPeriodStart` and no new period has been logged, show "X days late". Do not roll the period prediction forward automatically. Still draw the predicted period days from `nextPeriodStart` only if they are ≥ today, otherwise draw nothing for the overdue period.
- **Calendar projection:** draw predicted periods + fertile windows for the next `settings.predictCycles` cycles (default 3) by repeatedly adding `round(avgCycleLength)`.

### 5.5 Scientific rationale (for code comments / README)
- Ovulation is **not** fixed at cycle day 14. In 612,613 app-tracked ovulatory cycles, mean cycle length was 29.3 days, follicular phase 16.9 days (95% CI 10–30) and luteal phase 12.4 days (95% CI 7–17); only 13% of cycles were 28 days long (Bull et al., 2019). Hence ovulation is estimated **backwards from the next period** using a luteal length of ~12 days, rather than forwards from the last period.
- Fertile window = the 5 days before ovulation plus ovulation day (Wilcox et al., 1995).
- Calendar-only prediction is inherently imprecise; tracking physiological markers (BBT, LH) improves it (Bull et al., 2019) → v2.

---

## 6. Plugin wiring (`main.ts`)

- `onload()`:
  - load settings; create `LogStore`.
  - `registerView("cycle-tracker-view", leaf => new CycleView(leaf, this))`.
  - ribbon icon → activate the view.
  - commands:
    - `open-cycle-tracker` — Open Cycle Tracker
    - `log-today` — Log today (opens `DayModal` for today)
    - `open-log-file` — Open cycle log file
  - `addSettingTab(new CycleSettingTab(...))`.
  - register metadata/vault listeners through `this.registerEvent(...)` so they are cleaned up automatically.
- `onunload()`: nothing beyond the automatic cleanup; do not detach leaves (per Obsidian guidelines).

---

## 7. Settings

| Setting | Type | Default |
|---|---|---|
| Log file path | string | `Cycle Tracker/Cycle log.md` |
| First day of week | Monday \| Sunday | Monday |
| Default cycle length (no data) | number | 28 |
| Default period length (no data) | number | 5 |
| Luteal phase length | number | 12 |
| Max gap between flow days in one period | number | 1 |
| Cycles used for averages (N) | number | 6 |
| Outlier cycle bounds | min/max | 15 / 90 |
| Future cycles to project on calendar | number | 3 |
| Show fertile window | boolean | true |
| Flow colour | colour | `hsl(350 60% 55%)` |
| Symptom list | editable list | `cramps, bloating, headache, back pain, breast tenderness, fatigue, acne, mood swings, irritability, anxiety, cravings, nausea, insomnia` |

Symptom keys are stored lower-case. Renaming a symptom in settings does **not** rewrite past entries (show unknown keys as-is).

---

## 8. Privacy & safety

- **No network requests**, analytics, or external fonts/assets.
- README must state that the data is a plain file inside the vault and **will be synced** by Obsidian Sync / iCloud / Dropbox if the vault is synced; tell users how to exclude the folder (e.g. Obsidian Sync → excluded folders).
- Disclaimer in the dashboard footer, settings tab, and README: *"Cycle Tracker provides estimates only. It is not a medical device and must not be used for contraception."*

---

## 9. Testing

Unit tests (Vitest) for `src/core/`:

- **dates:** `diffDays` across month/year boundaries, leap years (2028-02-29), DST transition dates.
- **periods:**
  - consecutive flow days → one period;
  - 1-day gap with `maxGapDays = 1` → one period; 2-day gap → two periods;
  - spotting-only days do not create periods; spotting between flow days does not bridge a >maxGap gap;
  - unsorted / duplicate-date input is normalised.
- **cycles/stats:** median vs. outlier (e.g. lengths 28, 29, 30, 60 → median 29.5, 60 flagged if > max); SD null for n < 3.
- **predict:**
  - 0 / 1 / 2 / ≥3 periods → correct confidence state and fallbacks;
  - fertile window rolls to the next cycle once past;
  - overdue state;
  - ovulation = nextPeriodStart − luteal.

Manual test checklist (in a throwaway vault):
- Log a day → calendar and dashboard update without reopening the view.
- Edit the log file frontmatter by hand → view updates.
- Delete the log file → view shows the empty state; logging recreates it.
- Narrow pane and mobile → layout stacks.
- Light and dark themes are both readable.

---

## 10. Milestones

1. **Scaffold:** sample plugin renamed; settings tab; empty `CycleView` opening from ribbon/command.
2. **Data layer:** `LogStore` (create/read/upsert/delete/change events) + `core/` types and date helpers + tests.
3. **Calendar:** month grid, navigation, logged-flow rendering, `DayModal` writing to the log.
4. **Calculations:** periods, cycles, stats, predictions + full unit tests.
5. **Dashboard + predicted states on calendar** (period, fertile, ovulation), not-enough-data states.
6. **Polish:** responsive layout, theme variables, legend, disclaimer, README.
7. *(Optional)* Release workflow (GitHub Action attaching `main.js`, `manifest.json`, `styles.css`) and community plugin submission.

### Acceptance criteria (v1)
- [ ] Clicking a day opens the modal; saving persists to the log file in the documented schema.
- [ ] Dashboard shows next period (days + date ± range), next fertile window, average cycle length, average period length, current cycle day.
- [ ] Predictions update automatically after any change to the log file.
- [ ] Spotting is displayed but excluded from period detection.
- [ ] Works on mobile; no network requests; all `core/` tests pass.

---

## 11. Future (v2+)

- **BBT & LH logging** (fields already reserved in the schema). Confirm ovulation with the "3 over 6" rule (three consecutive temperatures above the maximum of the previous six, with the third ≥ 0.2 °C higher), or a positive LH test (ovulation typically within ~24–36 h). Use confirmed ovulation days to compute a **personal luteal phase length** (mean of nextPeriodStart − ovulation) to replace the default 12.
- Cycle history view (list of cycles with lengths, sparkline).
- Optional mirroring to daily-note frontmatter.
- Export to CSV.

---

## 12. References

- Bull JR, Rowland SP, Berglund Scherwitzl E, Scherwitzl R, Gemzell Danielsson K, Harper J. Real-world menstrual cycle characteristics of more than 600,000 menstrual cycles. *npj Digital Medicine*. 2019;2:83. https://doi.org/10.1038/s41746-019-0152-7
- Wilcox AJ, Weinberg CR, Baird DD. Timing of sexual intercourse in relation to ovulation — effects on the probability of conception, survival of the pregnancy, and sex of the baby. *N Engl J Med*. 1995;333(23):1517–1521. https://doi.org/10.1056/NEJM199512073332301
- Obsidian Developer Docs: https://docs.obsidian.md
- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- Obsidian plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
