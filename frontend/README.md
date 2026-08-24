# Ornament Sourcing Agent — Static UI

Next.js (App Router) + TypeScript + Tailwind implementation of the
`design_handoff_ornament/` package: the public landing site and the admin CMS.

**Scope of this phase: static UI markup and basic front-end interaction state
only.** There is no backend, no Prisma, no database, and no authentication.
Every list renders from `lib/data.ts`, and every "save" is local component state
plus a toast.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run typecheck
```

## Phase 1 — Design system

`organic-styles.css` was split in two:

- **`app/globals.css`** holds the tokens as CSS custom properties (verbatim from
  the handoff) plus the component classes the design system defines — `.btn`,
  `.tag`, `.input`, `.field`, `.card`, `.seg`, `.radio`, `.dialog`, and the admin
  primitives `.ad-panel` / `.ad-th` / `.ad-td` / `.ad-tab` / `.ad-navlink`.
- **`tailwind.config.ts`** maps those same variables onto Tailwind's scale, so
  utilities and design tokens can never drift: `bg-surface`, `text-accent-700`,
  `bg-sage-900`, `text-muted-70`, `max-w-shell`, `rounded-pill`, `shadow-md`, and
  the fractional spacing steps (`gap-4.4` = `--space-4`).

Fonts come from `next/font/google` (Caprasimo 400 display, Figtree 400/600/700
body) and are exposed as `--font-heading` / `--font-body`.

Icons are `lucide-react` at **stroke-width 2.75**, the weight the handoff specifies.

## Phase 2 — Layout and routing

| Route | Screen |
| --- | --- |
| `app/layout.tsx` | Root: fonts, metadata, globals |
| `app/(site)/layout.tsx` | Public shell — `SiteHeader` + `SiteFooter` |
| `/` `/catalog` `/produk/[slug]` `/journal` `/journal/[slug]` `/our-story` `/terms` `/pengrajin/[slug]` `/kontak` | The 9 public views |
| `app/admin/layout.tsx` | Admin shell — admin bar, permanent sidebar, sticky content header, toast host |
| `/admin` … `/admin/settings` (16 routes) | The 16 CMS screens |

The prototype's root `page` / `screen` state is now real routing. `aria-current`
drives active nav state in both shells.

`/admin/login` hides the entire chrome, so `app/admin/layout.tsx` renders its
children bare on that path — the toast host stays mounted, because sign-in
confirms with a toast too.

**The admin is a separate, private deployment.** Nothing on the public site
links to it, and nothing should be added that does.

## Phase 3 — Components

`components/site/` — `SiteHeader`, `SiteFooter`, `HeroCarousel`, `ProductCard`,
`ArtisanCard`, `ArticleCard`, `ProcessSteps`, `TermsAccordion`, `CatalogBrowser`,
`JournalBrowser`, `CommentSection`, `InquiryForm`, `ProductGallery`, `Section`.

`components/admin/` — `AdminBar`, `AdminSidebar`, `AdminHeader`, `ProductTable`,
`Tabs`, `PageHeading`, `ConfirmDialog`, `ToastProvider`, `AdminSearchContext`.

`components/ui/` — `Button` classes live in CSS; the shared React primitives are
`Tag`, `Field`, `Panel`, `Avatar`, `Logo`, `ImageSlot`.

The logo renders through `next/image` from `public/assets/` — `ornmnt-logo.png`
on light grounds, `ornmnt-logo-light.png` on the sidebar, footer, and admin bar.

## Responsive

Mobile-first. The handoff's max-width breakpoints are expressed as min-width
equivalents in `tailwind.config.ts`: `md` 681, `lg` 881, `xl` 981, `2xl` 1151,
`3xl` 1281. So: nav collapses to a hamburger below `lg`, the admin sidebar stops
being sticky and stacks above content below `lg`, the Page Builder steps 3 → 2 → 1
columns, and every table scrolls inside `.ad-tablewrap` rather than squashing.

## Interaction covered

Public: hero carousel, catalogue category + material filtering with load-more,
journal category filter, product gallery thumbnails, terms accordion, comment
form validation, inquiry form validation and confirmation card.

Admin: search (shared from the header), status tabs, material and region
filters, row selection, bulk actions with validation, duplicate, trash
confirmation dialog, pagination, page-builder block selection with per-block
edits and viewport preview, media load-more and upload, comment moderation,
inquiry reply flow, user invitations, settings tabs, login validation, toasts.

## Photography

The handoff ships **no photos**. Every image position renders `ImageSlot`, which
keeps the right aspect ratio and radius and prints the brief for the photo that
belongs there. Swap it for `next/image` once the client's assets arrive.

## Sample content

`lib/data.ts` is mockup data written for the prototype — realistic, not
operational. Confirm with the client before production. The company name,
address, email, and Instagram are real.
