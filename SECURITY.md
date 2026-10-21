# Security policy

🇧🇷 [Em português](#em-português)

Lighthouse for ether.fi Cash is a client-side dashboard: there is no server, no database and no telemetry. Everything runs in the browser of the person using it and reads the official, read-only ether.fi Cash connector. Even so, it handles OAuth tokens and personal financial data, so security reports are very welcome.

## Supported versions

Only the latest release (and `main`) gets fixes. The project is in `0.x`: there are no long-term branches.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository ([direct link](../../security/advisories/new)). Only the maintainers see it.

Include what you can: the affected screen, file or flow, steps to reproduce, the impact you expect, and the browser. **Never include real financial data** (yours or anyone's): no transactions, balances, wallet or deposit addresses, card digits, tokens or account screenshots. Use the demo (`/`) or the synthetic fixtures (`?fixtures=sample` in dev) to reproduce; if a real value is unavoidable, describe its shape instead (for example, "a 42-character address").

What to expect: an acknowledgement within 7 days, an assessment within 30 days, and credit in the release notes if you want it. This is a volunteer project with no bug bounty.

## Scope

In scope, for example:

- token handling (`src/lib/oauth.ts`, browser storage), the OAuth callback and PKCE;
- anything that lets text from the connector or from the AI files (`subscription-*.json`, `renewal-audit.json`) run code, change a link target, inject content into the calendar (`.ics`) export, or impersonate the interface;
- the deployment headers (`public/_headers`, `vercel.json`) and the Content Security Policy;
- `npm run pull` (`scripts/pull-history.mjs`): the local sign-in return, the client registration and where the files are written;
- the dev server's data endpoint (`/__fixtures`) and its file-serving rules (`vite.config.ts`): anything that lets another page, another device or another account read your real files;
- leaks of real data into the repository, the build or logs (see `npm run privacy`).

Out of scope:

- vulnerabilities in ether.fi itself, its app or its connector (`mcp.ether.fi`): report those to ether.fi directly;
- attacks that need a compromised device or browser, or a malicious extension;
- the rest of the dev server (`npm run dev`) when it is exposed to a network on purpose (`--host`): only the data endpoint and the data folder are in scope there.

## For people running it

- The OAuth tokens live in this browser only. To revoke access, use **Settings → AI Connections** in the ether.fi app; "Disconnect" in the dashboard only clears the local copy.
- The raw files from `npm run pull` are your full financial history. Create a `lighthouse-data` folder in your user folder (`%USERPROFILE%\lighthouse-data` on Windows, `~/lighthouse-data` on macOS and Linux): the pull, the dev server and the checks use it on their own, outside the project, out of git and out of cloud-synced folders (OneDrive, iCloud, Dropbox). `node scripts/data-dir.mjs` shows which folder is in use. Avoid a folder at the root of the drive, such as `C:\lighthouse-data`: on Windows it inherits write access for every account on the computer.
- In dev, `/__fixtures` answers only this computer and only the dashboard's own page (it checks the connection, the `Host` and `Sec-Fetch-Site`), and the data folder is closed to Vite's file server. Even so, don't run `npm run dev -- --host` on a shared network.
- Prefer a dedicated origin (your own domain or project) for a deployment: other pages on the same origin can read browser storage.
- Locally, the dashboard shares its origin with every other project you run on the same port (Vite uses 5173 for dev and 4173 for preview). Anything one of them stores or registers there (localStorage, IndexedDB, a service worker) is visible to the others. Run untrusted projects in another browser profile, and use “Forget everything in this browser” before switching projects: it also removes service workers and caches on this origin, and the Connection screen warns when a service worker from another project is controlling the page.

## Em português

**Não abra issue pública.** Relate em particular pelo GitHub: **Security → Report a vulnerability** neste repositório ([link direto](../../security/advisories/new)); só quem mantém o projeto vê. Diga a tela, o arquivo ou o fluxo, os passos e o impacto, e **nunca inclua dados financeiros reais** (transações, saldos, endereços, dígitos de cartão, tokens ou prints da conta): reproduza no demo ou com `?fixtures=sample`. Resposta em até 7 dias e avaliação em até 30. Não há recompensa. Falhas da própria ether.fi, do app ou do conector (`mcp.ether.fi`) devem ser relatadas à ether.fi. Para revogar o acesso do painel, use **Settings → AI Connections** no app da ether.fi; o "Desconectar" do painel só apaga a cópia local. Os arquivos do `npm run pull` são o seu histórico financeiro inteiro: crie a pasta `lighthouse-data` na sua pasta de usuário (`%USERPROFILE%\lighthouse-data` no Windows, `~/lighthouse-data` no macOS e no Linux), que o pull, o servidor de dev e os checks passam a usar sozinhos, fora do projeto, do git e de pastas sincronizadas com a nuvem; `node scripts/data-dir.mjs` mostra qual pasta vale. Evite pasta na raiz do disco, como `C:\lighthouse-data`: no Windows ela herda permissão de escrita para todas as contas do computador. No dev, o `/__fixtures` só responde a este computador e à própria página do painel, e a pasta de dados fica fechada para o servidor de arquivos do Vite; mesmo assim, não rode `npm run dev -- --host` em rede compartilhada. Localmente, o painel divide a origem com qualquer outro projeto que você rode na mesma porta (o Vite usa 5173 no dev e 4173 no preview). O que um deles guarda ou registra ali (localStorage, IndexedDB, service worker) os outros enxergam. Rode projetos de terceiros em outro perfil do navegador e use “Esquecer tudo neste navegador” antes de trocar de projeto: ele também remove service workers e caches desta origem, e a tela de Conexão avisa quando um service worker de outro projeto controla a página. Entram no escopo também o retorno local do login do `npm run pull` e as regras do servidor de dev para os dados reais.
