# Paper & Ink — CSS Notes

RICH-5603's **style**, the mockups' **original layout**. Reference: https://rich-5603.vercel.app/ (dark acid synth) → its visual language translated to DigitalOnda paper + ink, applied to the existing screen structure (hero card → readiness → up next → review queue / owed hero → minis → chart → ledger).
Files: `ella-paper-ink.html`, `cashflow-paper-ink.html`.

## The translation rule

Take the grammar, not the paint — and keep the app's own skeleton:

| RICH-5603 | Paper & ink version |
|---|---|
| #0B0B0B page | `--paper #F6F3E9` |
| Raised dark panels | `--panel #FDFBF3` + 1px `--ink-12` border |
| Recessed wells | `--well #ECE7D6` (chart columns, date tiles, tag chips, meter track) |
| Acid lime #D6FF3F | `--accent #E24B0F` red-orange · tint `--accent-soft #F7DFCE` |
| Lime LED dots | 6px accent LED dots on statuses |
| White mono text | `--ink #1C1A15` · secondary `--ink-60 #6E695B` |
| Rounded chunky controls | pills (999px) + 16px cards, flat, hairline-bordered |

## Tokens

```css
:root{
  --paper:#F6F3E9;              /* page */
  --panel:#FDFBF3;              /* raised card */
  --well:#ECE7D6;               /* recessed surface */
  --ink:#1C1A15;
  --ink-60:#6E695B;
  --ink-12:rgba(28,26,21,.12);  /* the ONLY border color */
  --accent:#E24B0F;             /* one accent: live/attention */
  --accent-soft:#F7DFCE;
  --r:16px;                     /* cards; wells 8-12px; pills 999px */
}
```

**One accent.** In RICH, acid lime = "active/alive". Here red-orange = active tab, primary CTA, owed money, LED-on, T–3, hot week. Never decorative; if two accents meet in one component, one is wrong.

## Type — one family

- Everything `'Space Mono', monospace` (400/700). The mono IS the look; no display face.
- Micro labels (signature): `9px · 700 · .22em tracking · uppercase · --ink-60`
- Row names: `12px · 700 · .05em · uppercase`; sub-lines `9.5px · .1em · uppercase · --ink-60`
- Values: bold 700, `tabular-nums`; money/countdown heroes `clamp(38px,10.5vw,58px)`; event name h1 `clamp(28px,7.4vw,42px)` uppercase +.04em
- Wordmark: `15px · 700 · .3em` + accent period ("ELLA·" / "CASH·")
- The only sentence-case text: queue-card body copy (11.5px/1.55). Never letterspace body text.

## Surfaces & depth

Flat. No shadows, no gradients. Depth = paper stack (well < paper < panel) separated by the single `--ink-12` hairline. Sticky top/bottom bars: translucent paper + `backdrop-filter:blur(12-14px)` + hairline.

## Components

**Pill (universal control)** — radius 999, mono 9px/700 tracked caps.
`ghost` panel+hairline (meta: "TUE JUL 14", "QB · READ-ONLY") · `outline` ink border, counts in accent ("REVIEW 3") · `accent` filled, text `#FFF6ED` — max one primary per screen.

**LED status (replaces colored chips)** — `::before` 6px dot + tracked microtext:
owed = accent dot+text · paid = ink dot, grey text · partial = accent-soft dot w/ accent border · contract/idle = hollow (ink-12 fill, grey border).

**Chart = wells** — per week: full-height recessed well (`--well`, border, r8) with inset ink bar (`<i>` bottom-anchored, `top:%` = value, r5). Hot week bar = accent; zero week = 3px ink-12 sliver. Bold amount above (accent when hot), 8px label below. Scrolls horizontally on mobile, flexes evenly on desktop.

**Readiness meter** — recessed pill track + ink fill; tags = well-pills with ink dots; the missing item flips whole pill to accent-soft/accent.

**Date tile** — 50px well square (r12): 8px month over 17px bold day.

**Streak banner** — the one inverted element: ink pill, paper text, accent LED. Use once per screen max.

**Totals row** — no card; `border-top:1px solid var(--ink)` (full-ink "sum rule" from print), owed span accent.

**Bottom tab bar** — 4 tabs, mono 8px/.2em caps; active = accent pill behind glyph + ink label; hidden ≥960px.

## Layout

- Mobile-first, single column `max-width:640px`, 16px gutters, `padding-bottom:96px` for the tab bar.
- ≥960px: `max-width:1080px`; Ella `1.6fr 1fr` (main / queue), Cash hero `1.5fr 1fr` then `1.2fr 1fr` (chart / ledger); tab bar off.
- Rhythm: 18–22px card padding · 9–10px row gaps · 28px section breaks.

## Don'ts

- No shadows, no gradients, no second typeface, no color beyond ink/paper/accent.
- No lowercase micro labels; tracking is for labels, never body.
- Statuses are always LED+text; actions are always pills — don't mix the two languages.
- Accent text on paper below 9px/700 fails contrast — keep accent marks bold.
