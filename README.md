# Lighthouse for ether.fi Cash

<img src="public/lighthouse.svg" alt="" width="48" />

**Your card, explained.** Lighthouse for ether.fi Cash is an open-source dashboard for **[ether.fi Cash](https://www.ether.fi/@moneyback)** accounts that runs entirely in your browser. It turns raw transactions into plain explanations: what changed, why it changed and what is worth checking. It also helps you catch subscription renewals before they charge you.

> Independent and open source. It reads your account through the official read-only connector and has no server of its own. Not affiliated with or endorsed by ether.fi.
>
> Not related to Google Lighthouse or Sigma Prime's Lighthouse Ethereum client.

🇧🇷 [Leia em português](README.pt-BR.md)

The interface is in **English by default**. Switch to Portuguese with the **EN | PT** toggle (the choice is saved in your browser).

| Desktop | Phone |
|---|---|
| ![Portfolio screen of the demo on a desktop browser](docs/screenshots/portfolio-desktop.png) | ![Portfolio screen of the demo on a phone](docs/screenshots/portfolio-mobile.png) |
| ![Spending screen of the demo on a desktop browser](docs/screenshots/spending-desktop.png) | ![Spending screen of the demo on a phone](docs/screenshots/spending-mobile.png) |
| ![Subscriptions screen of the demo on a desktop browser](docs/screenshots/subscriptions-desktop.png) | ![The "Start here" guide on a phone](docs/screenshots/start-mobile.png) |
| ![AI Insights tab of the demo, turned on, on a desktop browser](docs/screenshots/insights-desktop.png) | |

<sub>Screenshots of the demo and of the "Start here" guide (`#/start`): every number and name in them is fictional.</sub>

## What it does

Six screens, each answering one question (on a phone they sit in a fixed bottom bar):

- **Portfolio** (the first screen): what you have, in one sentence ("You have $12,480.55 at ether.fi"), with the value in your home currency next to it ("≈ R$68,500"), at the rate of your recent card purchases and labelled as an estimate. "How it’s split" shows each asset type’s share, in % and in dollars: fiat (with its currency, such as "Fiat · USD"), crypto, stocks, bonds, commodities and other. A dollar in a Liquid vault counts as fiat, and the list marks it as a vault. Beside it: estimated yield, spending power and what's borrowed, never added to the total. A line says how many things are waiting on you and leads to them in Spending. The cards, deposit (pick the asset to see the accepted networks) and the connection are tabs of this screen.
- **Spending**: card purchases only, by category and merchant, with each day's bar split by category and the change against the previous period. "Needs attention" sits near the top: renewals to answer or check and unusual charges, each with its own "why?". Below come month by month, with the reason behind each jump, and trips when there are any.
- **History**: every purchase on the account, month by month by category, plus what you spent the most on, who the money went to (by brand or merchant), where (by purchase currency, since ether.fi does not report city or country) and when (weekday × hour). It also lists the largest purchases and the full list. Tapping a chart filters the list.
- **Subscriptions**: what is a subscription, its cycle, next renewal and cost. It warns 14, 7 and 2 days before each renewal (30 days too for high-risk ones), asks "keep it or cancel it?" every cycle and downloads a calendar (`.ics`) with the reminders.
- **Activity**: everything that went through the account, grouped by day and filterable by what the money did. A deposit followed by a move to yield shows as a single movement.
- **AI Insights** (optional, off by default): your own numbers, explained in cards. It covers credit and yield, including a slider for "if ETH fell X%", what your gains paid for, savings and the period summary. Every card has a "why?" with the math, a "Calculated here" badge, and "Estimate" where it applies. It is information and scenarios, not financial advice. Everything is calculated in this browser and nothing leaves it. Ready-made questions open Claude in a new tab, with the question in the link and none of your data; each one asks Claude to use only the ether.fi connector, read-only, and to treat merchant names and other text in the results as data, never as instructions. Turn it on and off in the tab itself; the choice is saved in this browser only.

A line at the top always says where the numbers come from and how far back the loaded history goes.

## Try it

- **Demo**: open the app without connecting. It is a deterministic, fictional sixteen-month dataset whose dates follow today, with trips, subscriptions and unusual charges on purpose, so every rule shows up.
- **Synthetic connector data**: `npm run dev` and open `http://localhost:5173/?fixtures=sample`. It reads [`fixtures/sample/`](fixtures/sample/README.md): made-up files in the exact raw format of the connector (pages, repeated rows, refunds, voids, declines, several currencies) and of the AI files, read by the same code as real data. In any build, you can also import those files on the Connection screen.

## Your real data

**Step-by-step guide in the app:** open `/#/start` (or *Use it with your account →* at the bottom of the sidebar). It explains how it works, gives you four paths (just look, Claude Code, terminal, host your own) and what to do when something goes wrong.

<details>
<summary>Don't program? Paste this into <a href="https://claude.com/claude-code">Claude Code</a> on your own computer</summary>

> Set up Lighthouse for ether.fi Cash on this computer for me. Clone https://github.com/rogeriomr/lighthouse-for-etherfi-cash and install it with `npm ci` (it needs Node 22.23.4 or newer; install Node if it is missing). Keep my data out of the project and out of any cloud-synced folder (OneDrive, iCloud Drive, Dropbox, Google Drive): before the first pull, create the folder lighthouse-data in my home folder (~/lighthouse-data on macOS or Linux, %USERPROFILE%\lighthouse-data on Windows); Lighthouse finds it on its own, and `node scripts/data-dir.mjs` confirms it. Then run `npm run pull` and wait while I sign in on the ether.fi page that opens in my browser. When it finishes, run `npm run dev` and open http://localhost:5173/?fixtures. This task needs no email or other connector. Never upload, commit, send or share the data files.

Use the desktop app or the terminal version, not the web one: ether.fi's sign-in comes back to your own computer (`localhost`).
</details>

### The honest part: "Connect" does not work from your own site

The dashboard can talk to ether.fi's official MCP connector (`https://mcp.ether.fi/mcp`) with OAuth 2.1 + PKCE. As of 2026-10, though, **the connector refuses browser calls from any origin of our own**, not only `localhost`. We tested it: `localhost`, `*.pages.dev` and `*.github.io` get **403**, and `/oauth2/register` doesn't even answer the preflight. So a static deployment cannot connect directly, and the Connection screen says so for whatever origin it is on. If ether.fi ever allows an origin, see [Deploy](#deploy).

### What works in any build: pull, then import

1. In a copy of this project on your computer, run **`npm run pull`** (Node ≥ 22.23.4). It registers a public OAuth client, opens ether.fi's consent screen, follows every page of the statement and saves the raw responses as `.json` files. The token stays in memory only. The connection shows up in the ether.fi app under *Settings → AI Connections*, where you can revoke it.
2. Open the dashboard (your deployment, `npm run preview` or `npm run dev`), go to **Portfolio → Connection** and **import the `.json` files** with the file picker or by drag and drop. The files are read in the browser; nothing is uploaded.
3. By default the data stays in the tab's memory only. **Remember in this browser** keeps it in IndexedDB; **Forget these files** erases it.

The connector's pagination sometimes repeats a row across pages; each id counts once. If a page comes marked `incomplete` (the connector dropped rows it could not state exactly), the dashboard says the totals are partial.

### Where the files go: `lighthouse-data` in your home folder

The files are your full financial history. **Keep them out of the project and out of any folder synced to the cloud** (OneDrive, iCloud Drive, Dropbox, Google Drive). The simplest way: create a folder named `lighthouse-data` in your home folder once, before the first pull. `npm run pull`, `npm run dev`, the checks and `npm run privacy` find it on their own, with no variable:

```bash
mkdir -p ~/lighthouse-data                                              # macOS / Linux
New-Item -ItemType Directory -Force "$env:USERPROFILE\lighthouse-data"  # Windows PowerShell
```

Every script picks the folder the same way ([`scripts/data-dir.mjs`](scripts/data-dir.mjs)):

1. `LIGHTHOUSE_DATA_DIR`, if set (absolute, or relative to the project root);
2. `lighthouse-data` in your home folder (`~/lighthouse-data`, or `%USERPROFILE%\lighthouse-data` on Windows), if it exists;
3. `fixtures/live/`, inside the project and git-ignored. If the project sits in a synced folder, so does this one.

`node scripts/data-dir.mjs` says which folder is in use on your computer. Avoid a folder at the root of the drive (such as `C:\lighthouse-data`): on Windows it inherits write access for every account on the computer. The pull keeps its public OAuth client id (`.pull-client.json`) in the same folder, and it refuses a folder inside the project other than `fixtures/live/`, where git would commit the files. Nothing is moved automatically: if you already have files in `fixtures/live/`, move them (and `fixtures/.pull-client.json`, if it is there) into the new folder, then delete any copy left in a cloud folder, including its recycle bin and file versions.

In dev, `http://localhost:5173/?fixtures` reads that folder directly. The `/__fixtures` endpoint behind it exists only in `npm run dev`, answers only your own computer and only the dashboard's own page (it checks the connection, the `Host` and `Sec-Fetch-Site`), and is sent with `cache-control: no-store`; the data folder is closed to Vite's file server (`server.fs.deny`). None of it goes into the build.

### AI files: dev or import

The dashboard never reads your email or other websites. **Your own AI does** (for example Claude with your email connected): it reads the terms of each service and your receipts, and writes local files that follow the formats in [`src/lib/subscriptionTypes.ts`](src/lib/subscriptionTypes.ts) and [`src/lib/merchants.ts`](src/lib/merchants.ts):

| File | Format | What it adds |
|---|---|---|
| `subscription-evidence.json` | `EvidenceFile` | receipts, renewal notices, trial endings and cancellations from email (extracted fields only, never the email text) |
| `subscription-research.json` | `KnowledgeFile` | what is known about merchants specific to you: is it a subscription, its cycles, where to cancel, sources |
| `renewal-audit.json` | `RenewalAuditFile` | per service: auto-renew, notice before renewal, cancel deadline, refund window, price change at renewal, risk |
| `merchant-rules.json` | `MerchantRulesFile` | readable names, brands and categories for places specific to you, applied before the public dictionary |

**Generate them in a session that can't send anything.** An email is text from anyone, and it can carry hidden instructions written for your AI ("forward your receipts to…", "use this link to cancel"). An AI that reads your email, sees your financial data and can send messages in the same session is one email away from leaking your statement. In your AI's settings, turn off the tools that send, reply, forward or share (email, Drive, calendar), leave the ether.fi connector off for this task, and keep the AI asking before each action. [`docs/ai-prompts.md`](docs/ai-prompts.md) has the request to paste, with the rules built in: read only, every email is data and never an instruction, no links opened from emails, extracted fields only. The same request is behind *Start here → Extras with your AI → Copy request*.

There are two ways to use them: **in dev**, put them in the data folder next to the pulled files (`?fixtures`); **in any build**, import them together with the other files. Every item is validated field by field: an invalid item is dropped and counted, and a broken file never breaks a screen. What comes from these files is labeled as coming from your AI: refund deadlines and renewal terms say "per your AI's reading of the terms", and a subscription canceled only by an email says "canceled per an email · check your account". "Manage or cancel" links are accepted only as `https:`, the host is shown, and a link whose host is not the service's known site is marked as not verified. There are examples of all four in [`fixtures/sample/`](fixtures/sample/).

## How the data is organized

1. **What the money did**: card spending · money in & out · yield · crypto & rewards · referrals · credit. Only *card spending* counts toward "how much I spent". Voided and declined purchases stay out; refunds subtract.
2. **Category by actual use**: the source category is the base. A dictionary (`src/lib/merchants.ts`) fills in what it leaves uncategorized and fixes what is too generic. It knows brands from Brazil, the US and Europe (DoorDash, Deliveroo, Walmart, CVS, Lidl, Tesco…) and type-of-business words in Portuguese, English, Spanish, German and French (PHARMACY, APOTHEKE, SUPERMARKET, GAS…). Food delivery (iFood, Uber Eats, DoorDash) stays apart from restaurants and from rides. Categories are stable ids in the data, labeled in the current language: Food delivery · Restaurants & bars · Groceries · Transportation · Travel · Subscriptions & software · Shopping · Health · Education · Phone & internet · Entertainment · Home & garden · Other.
3. **Readable name + statement name**: "Cantina Aurora · via iFood" with `IFD*CANTINA AURORA LTDA` underneath, so you can recognize the purchase in the app.

**Currency:** the home currency is the most frequent local currency among purchases. Each purchase shows the local amount (what the card machine showed) and the US$ amount (what left the balance), with the effective exchange rate. Totals are in US$, with "≈" in the home currency, in whole units (the average exchange rate moves a few percent from month to month).

## Analysis rules (local and checkable)

- **Alerts** (`src/lib/analytics.ts`). The tone is neutral ("check", "good to know"); red is only for what is urgent.
  - *Duplicate*: same statement descriptor, same amount and currency, each charge at most 3 hours after the previous one. Three or more in a row become one alert. Balance top-ups (ride-app balance, phone and transit top-ups) are left out, and so is a repeat that happens on 3 or more different days (a routine, like a round trip). A refund of the same amount (±1%) and descriptor, after the first charge and within 30 days, resolves it (one refund per extra charge). It is red only while the repeat is still pending and at most 7 days old.
  - *Unusually large*: each purchase from the last 30 days is compared with the median of the earlier purchases at the same merchant (at least 2). It fires at ≥ max($100, 3× that median). Charges that the subscription engine assigns to a subscription, and merchants that the dictionary knows as subscriptions, are left out: price changes show up in Subscriptions.
  - *First time*: a merchant charged once, in the last 30 days, ≥ $10, with at least 60 days of history before it. A new place under a brand or platform you already use (a new restaurant through iFood) doesn't count, and neither does a known subscription merchant. Several new places on the same day become one alert.
  - *Stuck pending*: anything with your money still pending (purchase, deposit, swap), counted in calendar days: ≥ 7 days is good to know, ≥ 14 days is check now. Rewards (cashback, cashback claim, referral) don't count, and neither does the swap that goes with a cashback claim (≤ 5 minutes apart).
  - Needs attention (in Spending) counts the alerts from the last 30 days, plus stuck pending items of any age while they stay pending.
- **Trips**: purchases outside the home currency (or with a city), in sequence with at most 4 days between them, 3+ transactions. For people who don't live in the US, a USD charge without a city counts as an online service.
- **Month by month**: only shows with 2 full months in the history. A month is full when it is closed and the history covers it from day 1. The account's first month, when it opened after day 1, is partial, and so is a month that the loaded history covers only partly. If the connector marks a page `incomplete`, the dashboard says the totals are partial and compares no month. A month whose net total is ≤ 0, or whose refunds are above 50% of its purchases, shows purchases and refunds separately, with no % change. The current month is partial: the dashboard projects the close from the days elapsed so far, counting only the part of today that has passed, and says it is a projection.

## Subscriptions: where each signal comes from

- **Card**: recurrence by date (monthly, quarterly, semiannual, annual), with a stable amount. Recurrence alone, with no other signal, counts only when it is not weekly (groceries and laundry repeat out of routine), is not a balance top-up, and is in software, phone, entertainment or education, or is a small amount (up to US$ 30). It never goes above "medium" confidence, and neither does an estimated cycle. Rent, condo fees, insurance and school fees become a **recurring bill**: no "keep or cancel?", no reminders, no `.ics` and not in the monthly cost.
- **Public knowledge base** (`src/lib/subscriptionKnowledge.ts`): services known to bill as subscriptions, their cycles, where to cancel, and sources. The first entry that matches wins (specific before generic). Phone plans come in through a generic carrier entry (Vivo Easy, Claro, TIM, T-Mobile, Verizon and others), even with other purchases from the carrier in between.
- **Local research** (`subscription-research.json`): the same, for merchants specific to you.
- **Email** (`subscription-evidence.json`): receipts, renewal notices, trial endings and cancellations, with date, plan, cycle and end of period.
- **Renewal check** (`renewal-audit.json`): what each service's terms and emails say, with sources, the date it was checked and a risk level. High-risk renewals (annual, auto-renewing, no notice, no refund) get an extra 30-day reminder. Right after a renewal, the dashboard shows how many days are left to ask for a refund.
- **Local merchant rules** (`merchant-rules.json`): names and categories for places specific to you (your neighborhood bakery, a small service), applied before the public dictionary.
- **You**: "keep it", "I'll cancel" or "not a subscription", saved only in this browser. The answer is valid until the next renewal, when the dashboard asks again.

Some special cases:

- **Domains**: each domain is its own record. When the service charges the renewal before the expiry date (some registrars charge 30 days before), the date shown and the reminders follow the day of the charge. A paid period of 2 years or more shows as "every N years", with no yearly repeat in the `.ics`.
- **Usage-based billing**: when the amount goes up and down, the monthly cost is the average of the last 3 charges, shown with "≈".
- **Links**: "manage or cancel" links are `https:` only. One that comes from email or from the AI files and points outside the service's known site is shown as "not verified".

The calendar (`.ics`) is generated in the browser: one event per subscription that repeats on its cycle, with alarms 14, 7 and 2 days before (and 30 for high risk). Importing it again updates the same events.

## Deploy

The build is a static site (`npm run build` → `dist/`). The demo and the import of your files (or of the synthetic ones) work on any static host.

| Host | What to do |
|---|---|
| **Cloudflare Pages** | Build command `npm run build`, output `dist`, Node 22. `public/_headers` (copied into `dist/`) sets the security headers. With no `404.html`, Pages serves `index.html` for `/callback`. |
| **Netlify** | [`netlify.toml`](netlify.toml) has the build settings and the `/callback` rewrite. Netlify also reads `public/_headers`. |
| **Vercel** | [`vercel.json`](vercel.json) has the build settings, the `/callback` rewrite and the same headers. |
| **GitHub Pages** | Works for the demo and imports, but it can't send headers (so no CSP) and has no SPA fallback for `/callback`. A `user.github.io/project` site also shares its origin, and therefore its browser storage, with every other project page of that user. Prefer the hosts above. |

The headers are a strict **Content-Security-Policy** plus five more. The CSP sets `default-src 'none'`: scripts, styles, fonts and images come only from the site itself, and the network reaches only the site and `https://mcp.ether.fi`. It allows no frames, plugins or forms, sets `base-uri 'none'`, and turns on Trusted Types with no policy, because the app never writes HTML from text. The other headers are `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy` and `Cross-Origin-Opener-Policy: same-origin`. Fonts are served by the site itself, so a visit sends nothing to third parties. If you change the headers, change `public/_headers` and `vercel.json` together.

Deploying under a subfolder: build with Vite's `--base` (for example `npm run build -- --base=/lighthouse/`). The OAuth return is `<base>callback`, so that path needs the SPA fallback. This only matters if ether.fi allows your origin; in that case, add it to `CONNECTOR_ORIGINS` in `src/lib/config.ts` or build with `VITE_CONNECTOR_CORS=1`.

## Development

You need **Node ≥ 22.23.4** (`.nvmrc` says 22.23.4). The checks run TypeScript directly with `--experimental-strip-types`, which older Node versions don't have.

```bash
npm ci
npm run dev        # http://localhost:5173 (demo) · ?fixtures=sample · ?fixtures (your data, dev only)
npm run build      # tsc + vite build (dist/)
npm run preview    # serves dist/
npm run typecheck  # tsc, strict
npm run lint       # ESLint: React hooks rules are errors, the rest are warnings
npm run check      # the 9 check scripts, in sequence; fails if any of them fails
npm run privacy    # compares everything publishable (and dist/) with your real data; skips if there is none
npm run pull       # downloads your whole account from the connector (opens ether.fi's approval)
node scripts/gen-demo.mjs     # regenerates the demo dataset (deterministic)
node scripts/gen-sample.mjs   # regenerates fixtures/sample/ (deterministic)
```

`npm run check` runs:

| Script | Covers |
|---|---|
| `check-pipeline` | normalize → enrich → analytics on the demo (fixed targets) and on your data, if present (invariants only) |
| `check-history` | History aggregations: demo, a synthetic scenario and your data; time zones; EN and PT |
| `check-subscriptions` | subscription engine and `.ics`: synthetic scenarios, demo and your data; EN and PT |
| `check-anomalies` | alert rules: synthetic cases and invariants on your data |
| `check-demo` | the demo dataset contract, and the demo shifted to "today" |
| `check-sample` | the connector boundary with `fixtures/sample/`: pages, repeated rows, string amounts, refunds, voids, declines, currencies, `incomplete`, the AI files and the local merchant rules |
| `check-portfolio` | Portfolio states end to end: no deposit, empty wallet, failed tool, missing file, unlisted assets, balance without trading positions, stablecoin only, recent FX and the demo |
| `check-insights` | the AI Insights engine: credit and yield math, the PTAX series, the period summary, savings rules and cards; the red lines (no advice, no IOF, every card with a "why?", estimates marked) |
| `check-security` | red-team regressions: deposit QR/copy trust, links only over https, `.ics` field injection, merchant-rule regexes, amount parsing, rewards and card status |

The checks never print real values. With your data present, they only assert invariants.

**Before every commit, if you have real data on your machine, run `npm run privacy`.** It searches everything that would be published for the sensitive values in your files: statement descriptors, merchant + amount pairs, ids, addresses, emails, last 4 digits, email subjects, exact timestamps, local research and rules. It prints only `file:line`, the level and the kind of match. GRAVE findings must be replaced by made-up examples; a warning (a brand token that happens to match) is replaced too, unless it is a big public brand listed with a reason in `scripts/privacy-allow.json`. See [CONTRIBUTING.md](CONTRIBUTING.md) to make it a pre-commit hook.

## Privacy and security

- No server, no telemetry, no third-party analytics, no third-party fonts.
- The sign-in, your answers and remembered files stay in this browser, under `lighthouse:v1:*` (localStorage and sessionStorage) and the IndexedDB `lighthouse-v1`. Older keys migrate by themselves, once. **Forget everything in this browser** (Portfolio → Connection) erases them all except the language.
- Disconnecting erases only the local sign-in: ether.fi has no revocation endpoint. To revoke access for good, use *Settings → AI Connections* in the ether.fi app.
- Scopes: `transactions:read`, `cards:read`, `balances:read`. Everything is read-only, with no write path: the connector cannot move money, change cards or read card numbers.
- The AI files come from your own AI and are treated as untrusted: every field is validated, links are checked, and what they say is shown as coming from your AI. Generate them in a session that can't send anything: see [`docs/ai-prompts.md`](docs/ai-prompts.md).
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Stack and structure

React 19, TypeScript (strict, no `any`), Vite, Tailwind v4, Ark UI, Lucide and `qrcode.react`. Charts are plain SVG. The UI is in English (default) and Portuguese: the text sits side by side in the code (`tr('Spent', 'Gastei')`), and numbers and dates follow the language (en-US / pt-BR).

```
src/
  lib/           connector (mcp, oauth, normalize, rawFiles), enrichment and analyses (enrich, merchants,
                 analytics, history, subscriptions), formats (types, subscriptionTypes, validate), storage, demo/
  state/         store (demo | live | imported | fixtures), locale, attention, decisions
  components/    UI, SVG charts, alerts, activity row, subscription and portfolio parts
  views/         Portfolio (+ Account: Cards, Deposit, Connect), Spending (+ Evolution, Trips), History, Subscriptions, Transactions
scripts/         pull-history, data-dir, gen-demo, gen-sample, check-*.mts, check-all, privacy-scan
docs/            ai-prompts (the request for your own AI), RELEASING
fixtures/sample/ synthetic connector responses and AI files (versioned)
fixtures/live/   your data from npm run pull, if you have no ~/lighthouse-data (git-ignored)
```

## Notes

- The analyses are local estimates. The ether.fi app is the source of truth: check there before acting.
- Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Never paste real transactions, addresses or account screenshots in issues.
- What changed in each version: [CHANGELOG.md](CHANGELOG.md). Publishing and releases: [docs/RELEASING.md](docs/RELEASING.md).

## Trademarks

ether.fi and ether.fi Cash are trademarks of their respective owners, used here only to describe compatibility. This project is not affiliated with, sponsored by or endorsed by ether.fi. "Lighthouse" is the name of this independent project and has no relation to other products called Lighthouse.

## Author

Made by [@rogeriomenezesx](https://x.com/rogeriomenezesx). The ether.fi Cash links in the app and in this README use the author’s referral link; forks can change it in `src/lib/config.ts` (`ETHERFI_CASH_URL`).

## License

[MIT](LICENSE) © 2026 [@rogeriomenezesx](https://x.com/rogeriomenezesx) and Lighthouse for ether.fi Cash contributors.

The token icons in `public/tokens/` are trademarks of their owners, used only to identify each asset, and are not covered by the MIT license. Sources and terms: [`public/tokens/NOTICE.md`](public/tokens/NOTICE.md).
