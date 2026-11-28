# PayDay design spec

Goal: a calm, confident, editorial-feeling product. It should look like a well-funded fintech designed by a person: warm paper background, deep green accent, large serif headlines, hairline borders. It earns attention through scale, spacing and typography, not effects.

## Colour tokens (use only these; no other colours)

    --paper:        #F6F2EA;   page background (warm off-white)
    --surface:      #FCFAF5;   cards, inputs, tables
    --sunken:       #EFE9DD;   table header rows, code blocks, disabled
    --ink:          #17150F;   body text and headlines
    --ink-2:        #5E5848;   secondary text, labels
    --ink-3:        #8C8573;   hints, placeholders (use only on large text or with --ink-2 nearby)
    --line:         #DFD7C6;   1px borders and dividers
    --line-strong:  #C9BFA9;   input borders, focus-adjacent
    --accent:       #1E4D3A;   primary buttons, links, key numbers, "paid" state
    --accent-hover: #163B2C;
    --accent-soft:  #E3ECE4;   selected row, success surface
    --night:        #11201A;   the ONE dark band (landing hero strip, footer)
    --on-night:     #F6F2EA;
    --warn:         #8A5A12;   pending / expiring text
    --warn-soft:    #F3E7CF;
    --danger:       #A2362A;   errors
    --danger-soft:  #F4DEDA;

Rules: accent is for primary actions, links and "paid". Never gradients, never glow, never glassmorphism, never purple or blue. At most one --night band per page. Text contrast: --ink on --paper, --on-night on --night; do not put --ink-3 on --sunken.

## Type

Headings: Fraunces (variable, optical size on). Body and UI: Inter (variable). Addresses, codes and IDs: system monospace stack `ui-monospace, "SF Mono", Menlo, Consolas, monospace` at 0.9em.
Install via @fontsource-variable/fraunces and @fontsource-variable/inter (import in main.tsx; verify the package names exist before installing). No Google Fonts links, so the app works offline in a demo.

    --font-display: "Fraunces Variable", Georgia, serif;
    --font-ui:      "Inter Variable", system-ui, sans-serif;

Scale (rem, 16px base):
- display:  clamp(2.75rem, 6vw, 4.75rem), weight 500, line-height 1.02, letter-spacing -0.02em (landing headline only)
- h1: 2.25rem / 1.1, weight 500, Fraunces
- h2: 1.5rem / 1.2, weight 500, Fraunces
- h3: 1.0625rem / 1.3, weight 600, Inter
- body: 1rem / 1.55, Inter 400
- small: 0.875rem / 1.45, colour --ink-2
- label: 0.75rem, Inter 600, uppercase, letter-spacing 0.08em, colour --ink-2 (field labels, table headers, section eyebrows)
- Money and counts: Inter with `font-variant-numeric: tabular-nums`; big stat numbers in Fraunces weight 500, 2.5rem.

## Layout and shape
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 80, 120 px. Sections on the landing page are separated by 120px, app pages by 48px.
- Max content width 1120px (landing) and 960px (organizer app). Trainer and trainee screens: single column, max 440px, centred, 24px side padding.
- Radius: 6px on buttons, inputs and cards. No pills, no fully round shapes except the avatar-free design has none.
- Borders: 1px solid --line. Cards are --surface with a 1px border and NO shadow. The only shadow allowed is on modals: `0 12px 40px rgba(23,21,15,0.12)`.
- 12-column grid on desktop for the organizer app; stacks below 760px.

## Components
- Button primary: --accent background, --paper text, 44px high (52px on phone screens), padding 0 20px, weight 600. Hover --accent-hover. Disabled: --sunken background, --ink-3 text.
- Button secondary: transparent, 1px --line-strong border, --ink text. Hover background --sunken.
- Button text/link: --accent, underline on hover.
- Input: --surface background, 1px --line-strong border, 44px high, 6px radius, 12px padding. Focus: 2px --accent outline offset 2px. Label above, label style. Error: --danger border and a small --danger message below.
- Table: no outer border box; 1px --line between rows; header row --sunken with label style; numbers right-aligned and tabular; row height 52px. Status is plain text in label style coloured by state (accent = paid or enrolled, warn = pending, ink-2 = unclaimed). No pills, no dots.
- Stat block: label above, large Fraunces number, small unit text below. Four stats in a row on the organizer status page: Vault holds, Paid out, Still committed, Day.
- Day strip (the signature element): a row of equal square cells, one per programme day, 1px --line border. Cell states: future = empty --surface; today = 2px --ink border; checked in and paid = filled --accent with a small tick; missed (past, no check-in) = --sunken with a thin diagonal line. Shows the day number below each cell in small text. Used on the landing page (static illustration), the organizer status page (programme days) and the trainee status screen (own attendance). It never animates.
- Notice/banner: --surface with a 1px --line border and a 3px left border in --accent, --warn or --danger. Plain text, no icon needed.
- Modal: used only for the one-time link code. Shows the link in monospace, a Copy button and the sentence "This code is shown once."
- QR: black on --surface, 8px quiet zone, minimum 240px on phone, inside a card with the caption below.
- Countdown (relay QR): large tabular number "47s" under the QR and a 2px progress line that shrinks. No pulse, no colour flashing; at 10s the number turns --warn. At 0 the QR is replaced with the text "Expired" and a primary button "Make a new code".
- Icons: Lucide-style thin line icons (stroke 1.5), only where they replace a word (copy, camera, check). Inline SVG, no icon font. No emoji anywhere.

## Motion
Only: 150ms ease-out opacity and background-color transitions on hover and state change, and the shrinking countdown line. Nothing else moves. Respect prefers-reduced-motion by removing even those.

## Landing page composition (route #/)
1. Top bar: wordmark "PayDay" in Fraunces 1.25rem on the left; right side "Organizer" text link and "How it works" anchor. 72px high, 1px bottom border.
2. Hero (on --paper): small eyebrow label "STIPENDS FOR DAYS ATTENDED". Display headline: "Pay for the days people actually show up." Sub-line (max 56ch, --ink-2): "Funds sit in a vault no one controls. Each check-in is signed by a trainer and a participant, and pays out right away. What nobody earned goes back to the organizer." Primary button "Open organizer app", secondary "See how it works". Right of or below the text on desktop: a large static day strip (7 cells, 4 filled, 1 missed, 1 today, 1 future) inside a card with the caption "Day 5 of 7. 4 paid, 1 missed."
3. Three steps (on --paper, 3 columns): "1 Fund" / "2 Check in" / "3 Reclaim". Step number in Fraunces 2.5rem in --accent. Each has a heading and two plain sentences.
4. Night band (--night): one sentence in Fraunces 2rem in --on-night: "PayDay does not prove anyone was in the room. It makes every claim public, two-signed and checkable." Below, small text in on-night at 70% opacity: "Devnet demo. Test token only. The server sees participant PINs, so this is not non-custodial."
5. Footer on --paper: wordmark, "Built for the Dev3pack Global Hackathon", link to the GitHub repo, link to the program on Solana Explorer (devnet).

## Voice
Plain and specific. "Vault holds 800,000 units." "Day 2 of 3." "Code expires in 47s." Never: revolutionary, seamless, effortless, unlock, supercharge, empower, web3 buzzwords. Errors say what happened and what to do next in one sentence.
