# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (still `0.x`: anything may change). How to cut a release: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

## [0.3.0] - 2026-11-06

### Added

- **Borrow** (`#/borrow`): your Borrow-mode loan the way Aave lays out a position, in plain words (no health factor on screen). Borrowed, net worth, net APY, borrow power used and what's available; **what the collateral earns vs. what the loan costs** (yield and interest side by side, yield ÷ interest, the debt up to which interest stays below the yield) and a month-by-month chart of **how much of the loan the collateral's profit has paid** (yield minus loan interest, against what you borrowed), with vertical lines at 5%, 10%, 25%, 50%, 75% and 100% and their months, and a plain-words caption; **scenarios** at the top (1 · your account, 2 · lots of collateral: $50k USD Yield against $5k USDT, 3 · ETH collateral: $20k ETH Yield + $5k USD against $13k USDT, near the limit); the after-interest figure and its bars per **7 days, month or year**; how much the collateral earns and the loan grows **a month**, in green and red, per panel and per line; a **rate note** comparing loans in the same currency (and what changes beyond the rate); **your collateral** with only what's active, *Add* (the Earn vaults first, USD Bold, USD RWAs, USD, ETH, BTC and EUR, with the APY the app showed) and *Sync*; in the demo, the collateral here is only LiquidUSD, weETH and ETHFI; **your borrow** like the ether.fi app (active and available loans with rates), dollars (USDT + USDC), ETH and euros apart and a *Details* switch per asset; any number becomes a simulation; a card per volatile collateral (ETH, BTC…), side by side, with candles and three steps, each with its line and zone: **warning** (yellow), **attention** (orange, where the card stops spending) and **potential liquidation** (red), the alarm suggested at the yellow warning, a distance ruler and a "what if" slider; and **alarms** (loan health, debt, price) that check your real position, show on screen and on the menu, and can notify you in the browser while the tab is open. Parameters from ether.fi's published Lending Market Parameters (Aave V4 on Optimism, 2026-08-27); loan rates as seen in the app on 2026-11-05, editable.
- The ETHFI and sETHFI icons use the ether.fi mark from its official press kit. Token icons drawn for the project (MIT) for BTC, weETH, eBTC and the Liquid vaults (liquidUSD, liquidBold, liquidRWA, liquidEUR, liquidETH, liquidBTC, liquidReserve), which had none and have no artwork in the press kit: the asset's base glyph on a coin with a small badge (see `public/tokens/NOTICE.md`). *Add collateral* opens cards with the logo, the Earn vaults first with their APY.
- `check-borrow`: the Borrow math with fixed targets (the classic US$ 10,000 at 4.75% vs. US$ 300 at 3.55%), loans grouped by currency, liquidation prices with dollar and WETH debt, the projection and its 25/50/75/100% marks, alarms, stored preferences and candles, a lint of the screen's texts (no advice, no "health factor"), and invariants on your real data.

### Security

- The Content-Security-Policy now also allows `https://api.exchange.coinbase.com`, used only by the Borrow price charts after you turn them on (public candles; no cookie, no referrer, nothing about your account).

## [0.2.0] - 2026-11-02

### Added

- **Earnings** (`#/earnings`): what your estimated earnings pay for among your recurring costs. Yield per Liquid vault (and other assets with an APY) plus the expected card cashback flow into your subscriptions and recurring bills, cheapest first or in your own order, each paid in full or in part.
  - **The month's sum, as a receipt:** each subscription with its cost and the cashback it earns, then the cashback from the rest of your card spending, then what you hold in Liquid and what it yields a month, adding up to your monthly earnings and how many subscriptions they already pay. The shown cents always add up.
  - **Cashback:** follows the public monthly bands of your ether.fi Cash plan (Core by default; source and date on screen). The rate observed in your claims is shown for comparison, and you can use your own rate.
  - **Manual items:** add recurring costs by hand, saved in this browser only.
  - **Milestones:** a static, informative ladder of how much more earning in Liquid would also cover the next items, at today's APY. Every figure is labelled as an estimate, never as a recommendation.
  - **Shortcuts:** from Portfolio and from the monthly cost on Subscriptions.
  - **The summary comes first:** the screen opens with your monthly earnings, where they come from, the coverage bar (point at or tap a block to see what it pays) and how much in Liquid would cover 50%, 75% and 100% of your recurring costs at today's APY, one card per target. The itemised receipt follows below.
  - **Since your last visit:** what changed in your earnings (an item now covered or no longer covered, a new recurring charge, a price, an APY, the total, the next milestone), with a "what if" line from the milestones. The Earnings menu item gets a dot when there's something new. The last snapshot seen stays in this browser (`lighthouse:v1:earnings-seen`).
  - **Take it to your AI:** copies the month's sum as text (items, cashback, Liquid, the 50/75/100% amounts, milestones, assumptions and rules for the AI) to paste into the AI you use.
- **Portfolio** now opens with what your earnings pay, right under the balance: monthly earnings, where they come from, the coverage bar and the 50/75/100% amounts. Point at or tap a block of the bar to see the item, its cost and how much of it is paid (also on Earnings, and by keyboard).
- **Your AI:** `docs/ai/` (how Earnings is worked out, ready-made analyses, public sources and APIs), `AGENTS.md` for coding agents, with a `CLAUDE.md` pointing to it and a `lighthouse-earnings` skill for Claude Code in `.claude/skills/`.
- `npm run earnings`: the Earnings screen as Markdown or JSON, with the same engine and cents, "what if" scenarios (`--extra-liquid`, `--apy`, `--plan`), items by hand (`--add`), exclusions and monthly notices (`--changes --save`, a snapshot in the data folder).
- The phone bottom bar now has five items (Portfolio, Spending, Subscriptions, Earnings, More). **More** opens a sheet with History, Activity, AI Insights and the guide.
- `check-earnings`: the Earnings math, with fixed demo targets and invariants on your real data. It also applies every milestone and every 50/75/100% amount as a scenario and checks that it really covers, and checks "what changed", the text for your AI, `npm run earnings` and `docs/ai/earnings.md` against the code.

### Changed

- Demo cashback claims are paid in ETHFI, as in the real programme.
- The demo has more everyday monthly subscriptions at today's public US prices (Claude Ultra, Higgsfield Ultra, ElevenLabs Pro, Midjourney Standard, Peloton App One), with sources in the price book. The screenshots in `docs/screenshots` were retaken.

### Security

- Raised the Node.js baseline to 22.23.4 (CI also covers 24.22.1; the 26.x line starts at 26.12.1) for the October 2026 security releases. No application code changed.

## [0.1.0] - 2026-10-21

First public version.

### Added

- Six screens (Portfolio, Spending, History, Subscriptions, Activity, AI Insights) in English and Portuguese, mobile first, with a fixed bottom bar on phones. Each screen loads on demand.
- **Start here** (`#/start`): a step-by-step guide to using the dashboard with your own account, with four paths (just look, Claude Code, terminal, host your own) and what to do when something goes wrong.
- **Real data in any build**: `npm run pull` (now in the system language), then import the `.json` files on Account → Connection, by file picker or drag and drop. The data stays in memory by default, or is remembered in IndexedDB. The AI files (email evidence, local research, renewal audit) and the local merchant rules can be imported too, and every item is validated field by field.
- `LIGHTHOUSE_DATA_DIR`, to keep the pulled files outside the project and out of cloud-synced folders.
- **Rewards** panel on Account.
- **Subscriptions**: one answer per subscription, so the counter drops with each answer; a refund window right after a renewal, including an annual plan whose only charge in the loaded history is announced by a renewal email; recurring bills (rent, condo fees, insurance, school fees) kept apart from subscriptions; domains, usage-based billing and carrier plans; "manage or cancel" links marked "not verified" unless they are the curated public link, and unverified links left out of the `.ics` file.
- **Local merchant rules** (`merchant-rules.json`): names and categories for places specific to you, kept out of git. The places and niche services of the original author moved out of the public dictionary and knowledge base.
- Synthetic connector fixtures in `fixtures/sample/` (`?fixtures=sample` in dev), generated by `scripts/gen-sample.mjs`.
- `npm run check` (9 check scripts, now including `check-sample`, `check-portfolio`, `check-insights`, `check-security` and a `check-demo` with real assertions), `npm run typecheck`, `npm run lint` (ESLint, React hooks rules as errors), `npm run privacy` (two-level scan of everything publishable against your real data, with a reviewed allowlist of public brands).
- CI on Node 22 and 24, Dependabot (npm weekly, GitHub Actions monthly, minor updates grouped), issue and PR templates with a privacy warning, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and docs/RELEASING.
- Deployment files: `public/_headers` (Cloudflare Pages, Netlify), `vercel.json`, `netlify.toml`, and a web app manifest with icons for "Add to Home Screen".

### Changed

- The demo's dates follow today, and its deposit address is visibly invalid, so nobody sends funds to it by mistake.
- Alert rules, now described exactly in the README: duplicates within 3 hours and resolved by a matching refund; "unusually large" checks every purchase of the last 30 days; first-time and stuck-pending rules leave out rewards, top-ups and known subscriptions.
- A page marked `incomplete` by the connector now says the totals are partial and stops month comparisons; the account's first, partial month is not compared; "≈" in the home currency is shown in whole units.
- Category labels: EN "Home" is now **Home & garden**, EN "Delivery" is now **Food delivery**, PT "Compras" is now **Varejo**. The ids in the data did not change.
- Fonts are served by the site itself (no Google Fonts): a visit sends nothing to third parties.
- Browser storage moved under `lighthouse:v1:*` (and the IndexedDB `lighthouse-v1`), with a one-time migration of the older keys and "Forget everything in this browser".
- Error messages have codes and are shown in the current language.
- Node ≥ 22.13 (`engines`, `.nvmrc`).
- The license holder is "@rogeriomenezesx and Lighthouse for ether.fi Cash contributors"; ether.fi Cash links use the author's referral link (`ETHERFI_CASH_URL` in `src/lib/config.ts`).

### Security

- Strict Content-Security-Policy with Trusted Types and no policy, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` in the deployment headers. Tested on the build: no violation on any screen.
- A 20-agent red-team pass hardened the parsers: local merchant regexes reject optional-group and alternation chains that could freeze the tab; imports are capped at 20 files and 50 MB total; the deposit address is copyable only from a live connection, never from imported files; and the typographic minus (U+2212) keeps its sign. Disconnecting or forgetting now cancels loads already in flight, a malformed `%` in the hash no longer crashes the screen, and CI pins the actions by commit and Node 22.13.0.
- Links that come from email or the AI files are used only as `https:` and never become `javascript:` or `data:`.
- The `.ics` export strips control characters, so a lone carriage return can no longer inject calendar properties.
- The OAuth callback is handled only with a sign-in pending and shows fixed messages, never text from the URL. The token refresh runs once even when several requests expire together.
- The dev-only `/__fixtures` endpoint answers only the local machine and is sent with `no-store`; its code no longer ships in the production bundle.

[Unreleased]: https://github.com/rogeriomr/lighthouse-for-etherfi-cash/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/rogeriomr/lighthouse-for-etherfi-cash/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rogeriomr/lighthouse-for-etherfi-cash/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rogeriomr/lighthouse-for-etherfi-cash/releases/tag/v0.1.0
