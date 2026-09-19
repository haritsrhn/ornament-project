# Ornament Sourcing Agent — Static UI

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 3 implementation of
the `design_handoff_ornament/` package: the public landing site and the admin
CMS.

**Scope of this phase: static UI markup and basic front-end interaction state
only.** There is no backend, no Prisma, no database, and no authentication.
Every list renders from `lib/data.ts`, and every "save" is local component state
plus a toast.

```bash
npm install      # dari root repo, bukan dari folder ini
npm run dev      # http://localhost:3000
npm run build
npm run typecheck
npm run lint
```

## Versi

| Paket | Versi |
| --- | --- |
| `next` | 16.3.5 |
| `react` / `react-dom` | 19.3.x |
| `tailwindcss` | 3.4.x |
| `postcss` / `autoprefixer` | 8.5.x / 10.4.x |
| `lucide-react` | 0.577.x |
| `eslint` | 10.x |

## Lint

Next 16 menghapus perintah `next lint`, jadi ESLint dipanggil langsung:

```bash
npm run lint --workspace frontend      # sama dengan: eslint .
```

Konfigurasinya ada di [`eslint.config.js`](eslint.config.js) (flat config,
CommonJS karena paket ini bukan ESM): `eslint-config-next/core-web-vitals` +
`eslint-config-next/typescript` + `eslint-config-prettier` di akhir supaya tidak
bentrok dengan Prettier. `npm run lint` di root sekarang mencakup workspace ini,
dan job `frontend` di CI menjalankannya.

Dua pengecualian yang dimatikan beserta alasannya:

- `@next/next/no-html-link-for-pages` di `components/admin/AdminBar.tsx` — dua
  tautan "lihat situs" memang navigasi penuh, karena situs publik adalah
  deployment terpisah dari admin.
- `@typescript-eslint/no-require-imports` di file config CommonJS
  (`eslint.config.js`, `postcss.config.mjs`).

## Catatan Next 16 / React 19

- `params` pada route dinamis (`produk/[slug]`, `journal/[slug]`,
  `pengrajin/[slug]`) sekarang **Promise**, jadi page dan `generateMetadata`-nya
  `async` dan meng-`await` `params`. `generateStaticParams` tidak berubah.
- `useRef` di React 19 wajib punya argumen awal
  (`useRef<T | undefined>(undefined)`).
- Komponen tidak boleh dibuat di dalam render (aturan
  `react-hooks/static-components`); `SaveRow` di `app/admin/settings/page.tsx`
  dipindah ke module scope dengan prop `onSave` — markup-nya identik.
- `tsconfig.json` memakai `"jsx": "react-jsx"` (wajib Next 16) dan menambah
  `.next/dev/types/**/*.ts` ke `include`.
- Belum ada pemanggilan `fetch` di frontend, jadi perubahan default cache Next 15
  (`fetch` tidak lagi di-cache otomatis) tidak berpengaruh pada kode saat ini.

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
