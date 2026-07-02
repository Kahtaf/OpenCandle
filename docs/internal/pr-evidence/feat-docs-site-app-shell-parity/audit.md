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

## Explicitly deferred

- Homepage navbar height stays h-14 (marketing scale; the app has no landing
  navbar to mirror, and DESIGN.md only prescribes the vocabulary, not 48px).
- Right-rail TOC has no app equivalent; it is kept (docs convention) but
  restyled to the app's label/link vocabulary.
