# Docs site vs GUI app shell — inconsistency audit

**Status: items 1–13 resolved** (see commits on this branch; after/ screenshots).
Deferred items listed at the bottom with reasons.

Audited 2026-07-02 against the running GUI (127.0.0.1:14567) and the built site
(website/dist served locally). GUI code (`gui/web`, `packages/ui`) is source of
truth; DESIGN.md/DESIGN.json used as the map. Before screenshots in `before/`.

## Navigation (primary issue)

1. **Desktop docs nav is a boxed card column** inside the content grid. The app
   shell uses a full-height 260px `bg-secondary` sidebar with `border-r`, a
   brand header row inside the sidebar, and a collapse control (`PanelLeft`).
   → Rebuild as app-shell sidebar.
2. **Mobile docs nav is a `<details>` "Docs navigation" dropdown** above the
   article. The app uses a 48px mobile header (hamburger `Menu` + wordmark)
   opening a bottom drawer (drag handle, `bg-secondary`, rounded-t-xl, dimmed
   backdrop). → Rebuild as header + drawer.
3. **No collapse/expand affordance.** The app collapses the sidebar and shows a
   `PanelLeftOpen` restore button in a 48px top bar. → Add, persisted in
   localStorage.
4. **Docs pages keep a sticky top navbar (h-14, Home/Docs/GitHub/Install)**
   duplicating the sidebar's job; the app has no top navbar on desktop when the
   sidebar is present. → Remove on docs pages; brand + GitHub + Install move
   into the sidebar. The homepage (landing) keeps the navbar per DESIGN.md
   navbar vocabulary.

## Component / token drift

5. **Section labels**: docs `text-[0.68rem] uppercase` without tracking; app
   uses `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`.
6. **Nav item states**: docs items hover `bg-secondary` on a card background;
   app items on the secondary sidebar hover/select with `bg-tertiary` and
   muted→foreground text (see `history-item.jsx`).
7. **Docs article is wrapped in a bordered card** with prose running ~860px
   wide; the app renders page content on the plain background and DESIGN.md
   caps prose at 720px. → Plain background, `max-w-[720px]` article.
8. **"On this page" TOC is a boxed card**; restyle as a quiet rail using the
   sidebar label vocabulary (no card box).
9. **Docs tables use a full cell-border grid with shaded header** — the app
   table grammar is 12px/500 graphite headers, horizontal hairline rules only,
   no header fill, no vertical borders.
10. **Homepage hero is one giant card containing nested Cards** (evidence card,
    feature cards, screenshot card, aside cards). Nested cards are prohibited
    (DESIGN.md; the app never nests cards). → Drop the outer wrapper card.
11. **Homepage FAQ renders bordered `<details>` boxes inside a Card** — nested
    boxes again. → Hairline-divided rows inside the card.
12. **Navbar Install CTA is rounded-md**; DESIGN.md reserves the pill shape for
    page-level primary CTAs and describes the navbar as "pill brand CTA".
    → `rounded="full"`.

## Housekeeping

13. **`website/styles.css` (1,144 lines) is dead** — the retired DM Sans/slate
    theme incl. the old `.site-nav`. Nothing references it (Vite builds
    `src/entry-client.jsx` → `src/site.css`). → Remove in its own commit.

## Fresh-eyes subagent review (post-fix)

A no-context reviewer compared both running sites and confirmed "the two
sites clearly read as the same product" with matching fonts, palette,
sidebar metrics, labels, badges, and drawer behavior. Its findings:

1. Hero/aside Install buttons not pill-shaped → **fixed** (rounded full).
2. Docs buttons 40px vs app 32px → **not reproducible**; measured 32px at
   1440px (sm buttons are 40px only below the md breakpoint, same as the GUI).
3. Homepage hero h1 smaller than docs titles → **per DESIGN.md** (docs titles
   use the display scale 1.75rem, homepage hero the headline scale); the
   missing -0.01em letter-spacing was real and **fixed**.
4. Docs nav items lack icons/500 weight of the app's Market State nav →
   **deferred**: docs pages mirror the GUI's session-list idiom
   (`history-item.jsx`: icon-less, 400 weight), which is the closer analogue
   for a list of documents; icons per docs page would be invented semantics.
5. Docs active nav pill visible vs app's invisible active fill → **deferred**:
   the GUI itself is split (Market State nav uses bg-secondary = invisible on
   the secondary sidebar; session items use visible bg-tertiary). Docs follows
   the session-item treatment, which is the one that actually reads.
6. Mobile table clipping with no scroll affordance → **fixed** with a CSS
   scroll shadow on horizontally scrollable tables.

## v2: unified navigation (user direction, 2026-07-02)

After review, the homepage and docs pages read as two sites with different
navigation. Reworked to the standard docs-site shell (Tailwind/Vite/shadcn
pattern): one sticky navbar on every page (wordmark, Docs, Compare, GitHub,
pill Install, hamburger on mobile), docs sidebar under the navbar on desktop,
the bottom drawer reachable from the navbar hamburger on all pages including
the homepage, and a shared footer. The desktop collapse feature from v1 was
removed: it existed to mimic the app shell, and the unified pattern replaces
it (popular docs sites do not collapse the docs sidebar). The homepage was
rebuilt as a narrative landing page: claim-first hero, evidence receipt,
chatbot contrast, GUI tour, builder section with a typed-tool sample, install
commands, FAQ. Screenshots: `after/home-desktop-full.png`,
`after/docs-desktop-unified.png`, `after/home-mobile-unified.png`,
`after/home-mobile-drawer.png`.

## Fresh-eyes review of v2 (post-unification)

A second no-context reviewer confirmed both goals: "one site — passes" (same
navbar component, tokens, and footer verified via DOM on both page types;
same drawer on homepage and docs) and "the why is instant" for both a retail
ChatGPT user and a developer above the fold. Its findings, all applied:

1. Navbar had no active-section state → Docs/Comparisons now render ink with
   `aria-current` on their sections.
2. Navbar "Compare" vs sidebar "Comparisons" label mismatch → navbar renamed
   to "Comparisons".
3. Bring-your-own-model requirement was buried at the bottom → one muted line
   under the hero CTAs ("Bring your own Anthropic, OpenAI, or Google model
   key · market data needs no keys").
4. "through typed tools" in the hero was developer jargon → now "through real
   market data tools"; "typed" lives in the builder section with the code
   sample.
5. H1 ambiguity ("market research") judged acceptable — subhead disambiguates
   in one sentence. Left as is.

Reviewer screenshots: `fresh-eyes-v2/`.

## v3: density + docs IA pass (user direction, 2026-07-02)

Both surfaces read dense and word-heavy. Changes:

- **Docs IA reorganized as a first-time visitor's journey** (URLs unchanged,
  registry-only): Start here (Overview, Why OpenCandle, Getting Started, First
  Run, GUI Quickstart) → Guides (Terminal (TUI), Investigation Recipes) →
  Reference (Data Sources, Configuration) → Build → Project → Resources.
  A `navLabel` field renames sidebar entries without touching page titles;
  "Comparisons" surfaces as "Why OpenCandle" right after the overview.
- **Copy tightened**: hero subhead cut from 48 to 30 words, receipt footer to
  one sentence, chatbot-contrast bullets to fragments, builder/start/workbench
  paragraphs halved. docs/index.md rewritten as a scannable map (kept the
  contract-test heading strings).
- **Breathing room**: hero pt-16/sm:pt-24, section padding 14→16–24 units,
  docs main py-6→py-10, docs line-height 1.65→1.75, paragraph gaps 1→1.25rem,
  h2 top margin 2→3rem, sidebar group gap 3→5.
- **Bug found while spacing**: the TOC's `sticky top-6` pinned it under the
  sticky navbar on scroll; now `top-20`.

Screenshots: `after/docs-index-v3.png`, `after/home-desktop-v3.png`,
`after/home-mobile-v3.png`.

## Explicitly deferred

- Homepage navbar height stays h-14 (marketing scale; the app has no landing
  navbar to mirror, and DESIGN.md only prescribes the vocabulary, not 48px).
- Right-rail TOC has no app equivalent; it is kept (docs convention) but
  restyled to the app's label/link vocabulary.
- Fresh-eyes findings 4 and 5, per above.
