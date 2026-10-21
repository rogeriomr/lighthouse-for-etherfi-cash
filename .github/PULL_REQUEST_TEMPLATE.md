## What and why · O quê e por quê

<!-- One or two sentences. Link the issue: Closes #123 · Uma ou duas frases. -->

## How to see it · Como ver

<!-- Route and data source: demo (/), ?fixtures=sample, or imported files. Screenshots ONLY from the demo or the synthetic fixtures. · Rota e fonte dos dados. Prints SÓ do demo ou das fixtures sintéticas. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm run check` pass · passam
- [ ] `npm run privacy` passes on my machine (or skips: I have no `fixtures/live/`) · passa na minha máquina (ou pula: não tenho `fixtures/live/`)
- [ ] **No real data** in code, comments, tests, fixtures, screenshots or this description: transactions, merchant names from a real statement, amounts, addresses, ids, card digits, emails · **Nenhum dado real** no código, comentários, testes, fixtures, prints ou nesta descrição
- [ ] New UI text exists in English and Portuguese (`tr('…', '…')`), with correct accents · Texto novo nas duas línguas, com acentuação correta
- [ ] Checked at 390 px and 1366 px wide, no horizontal scroll, nothing hidden by the bottom bar · Conferido a 390 e a 1366 px, sem rolagem horizontal, nada coberto pela barra inferior
- [ ] If I changed what the connector returns or how it is read: updated `fixtures/sample/` (`node scripts/gen-sample.mjs`) and `scripts/check-sample.mts` · Se mudei a leitura do conector: atualizei as fixtures sintéticas e o check
- [ ] If I changed the deployment headers: `public/_headers` and `vercel.json` say the same thing · Se mudei os cabeçalhos: os dois arquivos dizem o mesmo
