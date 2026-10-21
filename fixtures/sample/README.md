# Synthetic fixtures · Fixtures sintéticas

**Everything here is made up.** These files have the exact *shape* of what the ether.fi Cash connector returns (keys, types, decimal strings, pages from newest to oldest) and of the files your own AI writes for the Subscriptions screen, so you can work on the dashboard without an account. No value, name, id or address comes from a real account.

**Tudo aqui é inventado.** Os arquivos têm a mesma *forma* das respostas do conector da ether.fi Cash e dos arquivos que a sua IA escreve, para mexer no painel sem conta. Nenhum valor, nome, id ou endereço vem de uma conta real.

## Use · Uso

- In the browser (dev): `npm run dev` and open `http://localhost:5173/?fixtures=sample`.
- In any build: import these files on the Connection screen, exactly like the files from `npm run pull`.
- In the checks: `scripts/check-sample.mts` (part of `npm run check`) reads them through the same code as the app.
- To change the scenario, edit `scripts/gen-sample.mjs` and run `node scripts/gen-sample.mjs` (deterministic: same output every run).

## Files · Arquivos

| File | What it is |
|---|---|
| `list_transactions.page1…4.json` | The statement, one connector page per file, newest first. The last row of page 1 comes back as the first row of page 2 (and 3 → 4), like the real pagination; the last page has `nextPage: null`. |
| `incomplete/list_transactions.page3.json` | The same page 3 marked `incomplete: true` with a few rows missing, as the connector sends it when it drops rows it can't state exactly. It lives in a subfolder so `?fixtures=sample` shows the full history; the check swaps it in. |
| `list_cards.json` | 4 cards: active (one without a nickname), cancelled and a physical card not yet activated. |
| `get_main_account.json`, `get_portfolio.json` | Balances as decimal strings; one holding without a quantity; `unrenderableAssetCount: 1`, so the listed portfolio is partial. |
| `get_deposit_address.json` | A **visibly invalid** address (`0xSAMPLE-…-DO-NOT-SEND`): never send funds to anything you see in a sample. Each asset lists only the networks it is accepted on. |
| `subscription-evidence.json` | Email evidence (`EvidenceFile`): a receipt, a cancellation, a price change and an annual renewal notice. |
| `subscription-research.json` | Local research (`KnowledgeFile`) about the fictional services, including one "not a subscription". |
| `renewal-audit.json` | Renewal audit (`RenewalAuditFile`): auto-renew, notice, cancel deadline, refund window and risk. |
| `merchant-rules.json` | Local merchant rules (`MerchantRulesFile`): readable names, brand, category and an accent fix. |

The formats are defined in `src/lib/subscriptionTypes.ts` and `src/lib/merchants.ts`; `.example` domains are reserved and never resolve.

## Scenario · Cenário

About six months (2026-04-02 → 2026-10-14) of a person whose home currency is **EUR**:

- everyday purchases (market, café, restaurants, delivery, rides, pharmacy, fuel, books), most with the connector's category, some without;
- subscriptions on fictional services: two monthly ones in USD (one declined once and retried), a streaming plan in EUR cancelled by email, a gym whose price went up, and an **annual plan renewed 16 days before the end**, still inside its refund window;
- two trips (JPY and GBP), a single purchase in MXN that is not a trip, a declined purchase abroad and a partial refund with status `REFUND`;
- a refund as a negative amount, voided pre-authorizations, a duplicate delivery order, an unusually large purchase, a first-time merchant and a purchase pending for more than 14 days;
- money in, yield, swaps (amounts with up to 24 decimals), a bridge, a withdrawal, a repayment, pending on-chain rows in both date formats (`…Z` and `…+00:00`), and one row of an unknown type that must be shown as "other", never as a purchase.
