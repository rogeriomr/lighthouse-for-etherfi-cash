# Publicação segura (runbook do mantenedor)

Este documento explica **o que é publicado, o que nunca pode ser publicado e por quê**, e a ordem segura para
transformar esta pasta em um repositório público. Os comandos detalhados do primeiro push e de cada release estão em
[`RELEASING.md`](RELEASING.md); aqui fica o contexto para decidir com segurança.

Regra de ouro: **um push é permanente**. O GitHub guarda cada commit, e forks, caches e o histórico de ações copiam
os objetos. Não existe "apagar depois": a única proteção confiável é conferir antes do primeiro push.

## 1. O que este projeto é

- Dashboard **read-only** para ether.fi Cash, 100% no navegador: sem servidor, sem banco, sem telemetria, sem
  analytics e sem fontes de terceiros.
- O código publicado é só o cliente: React + Vite, demo fictício, fixtures sintéticas, prints do demo (confira a
  olho, seção 3) e documentação.
- O que a pessoa usuária importa (arquivos do `npm run pull`) fica no navegador dela: memória, IndexedDB (se ela
  pedir para lembrar) ou `sessionStorage` para o token OAuth. Nada disso volta para o repositório nem para um servidor.
- O deploy é estático (Vercel, Netlify ou Cloudflare Pages). O build publicado não contém dados de ninguém.
- `package.json` tem `"private": true`: o projeto não é publicado no npm; o GitHub é o canal de distribuição.
- Licença MIT, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` e CI com typecheck, lint, build, checks e
  varredura de privacidade.

## 2. O que nunca pode entrar no git

| Item | Onde vive hoje | Como é barrado |
|---|---|---|
| Respostas reais do conector (`npm run pull`) | `%USERPROFILE%\lighthouse-data` (fora do projeto) ou `fixtures/live/` | `.gitignore`: `/fixtures/*` + `!/fixtures/sample/`; `lighthouse-data/` |
| `fixtures/.pull-client.json` (client id do pull) | fora do projeto | `**/.pull-client.json` |
| Exports que carregam dados: `.ics`, `.csv`, `.har`, `.zip` | pasta do usuário | regras por extensão |
| Segredos e configuração local (`.env*`, `*.local.json`) | — | `.env*` e `*.local` |
| Build e dependências (`dist/`, `node_modules/`, `*.tsbuildinfo`) | pasta local | regras próprias |
| Diretórios de ferramentas e restos (`.claude/`, logs, `.eslintcache`) | pasta local | regras próprias |
| Print de conta real | — | revisão a olho: só entram prints do demo ou das fixtures |

O `.vercelignore` repete o critério para quem faz deploy pela CLI da Vercel, que **não lê** o `.gitignore`.

## 3. Estado publicado (21/10/2026)

- Repositório público `rogeriomr/lighthouse-for-etherfi-cash`; `main` no commit `389c01e` ("Lighthouse for ether.fi
  Cash 0.1.0"), árvore limpa e upstream `origin/main` via SSH.
- Demo em produção: <https://lighthouse-for-etherfi-cash.vercel.app>. O projeto na Vercel não tem integração Git; o
  deploy é feito pela CLI (`vercel deploy --prod --yes`). Último deploy validado: HTTP 200, CSP/CORP presentes e
  `/callback` com `no-store`.
- CI verde nos jobs `Node 22.23.4` e `Node 24.22.1` (typecheck, lint, build, `npm run check` e `npm run privacy`).
- `main` protegida: os dois checks são obrigatórios, sem force-push, sem deleção, histórico linear e conversas
  resolvidas; `enforce_admins: false` (decisão consciente para projeto solo).
- Segurança do repositório: secret scanning com push protection, relato privado de vulnerabilidade e Dependabot
  alerts/security updates ativos.
- `npm run privacy`: **0 GRAVE, 0 aviso fora da allowlist**, comparando **229 arquivos publicáveis** com **5.175
  valores** sensíveis dos dados reais.
- 7 prints do demo em `docs/screenshots/` (desktop 1366×900, mobile 780×1688), usados no README.
- Sem `.env.local`, `fixtures/live/` ou `.pull-client.json`; dados reais em `%USERPROFILE%\lighthouse-data`.
- **Pendente:** ativar 2FA/passkey na conta, mover o projeto para fora do OneDrive e criar a release `v0.1.0`.
- O primeiro push usou uma deploy key de escrita (`lighthouse deploy`, chave em `~/.ssh/lighthouse_ed25519`) porque
  o token do `gh` não tinha o escopo `workflow`; o remote `origin` ficou em SSH.

### O que foi feito até a publicação

- Red team de 20 agentes e correções: regex de merchant sem ReDoS, depósito copiável só de conexão ao vivo, links de
  assinatura só de host oficial, limite de 20 arquivos/50 MB na importação, U+2212 preservado, câmbio negativo
  recusado, sinal de `amountUsd` alinhado à compra, datas cruas do BCB aceitas, `decodeURIComponent` seguro no hash,
  prompt da IA tratando links e nomes como dados, CI com actions pinadas por SHA e Node 22.23.4.
- Prints do demo regenerados; proveniência do demo ajustada para "coerente com o modelo publicado"; aviso de
  indicação adicionado ao lado do link ether.fi Cash.
- Commit `389c01e`, deploy de produção e validação de headers; push e CI concluídos.

## 3.1. Linha do tempo

| Quando | O que aconteceu |
|---|---|
| Antes do push | Red team, correções, testes de regressão, prints e documentação |
| 21/10/2026 | Commit `389c01e` e deploy em produção na Vercel |
| 21/10/2026 | Push para `main` via deploy key; CI verde nos dois Nodes |
| 21/10/2026 | Branch protection e recursos de segurança do GitHub ativados |
| 21/10/2026 | Baseline Node.js elevado para 22.23.4 (CI 24.22.1) após os releases de segurança |
| Pendente | 2FA/passkey, saída do OneDrive e release `v0.1.0` |

## 4. Decisões que são suas (e que o código não decide)

1. **Onde o repositório vai morar.** Hoje o projeto está no Desktop sincronizado pelo OneDrive. O `.git` e o histórico
   iriam para a nuvem, e versões antigas de arquivos apagados podem sobreviver no OneDrive. Mova a pasta para fora
   de qualquer pasta sincronizada quanto antes (seção 5).
2. **Conta do GitHub.** Ative 2FA/passkey em <https://github.com/settings/security>. O maior risco de um projeto
   assim não é o código: é alguém assumir sua conta e publicar uma versão maliciosa que lê dados financeiros.
   Ative também "Keep my email addresses private" e "Block command line pushes that expose my email".
3. **Identidade pública.** O repositório expõe, de propósito, `@rogeriomenezesx` (autor, LICENSE, rodapé) e o código
   de indicação `@moneyback` no link do ether.fi Cash. Se não quiser associar os dois ao projeto, troque antes do
   primeiro commit (`package.json`, `LICENSE`, `src/lib/config.ts`).
4. **Marca.** O nome usa "ether.fi Cash"; o app se declara independente, sem logo nem cor da ether.fi. É uso
   nominativo, mas é marca de terceiro: não há aval da ether.fi.
5. **Rigor da proteção da `main`.** `enforce_admins: false` deixa você contornar a proteção; `true` exige PR e CI até
   para o dono. Para um app que lê finanças, `true` é mais seguro (e mais burocrático).
6. **Nome/owner do repositório.** `REPO_URL` em `src/lib/config.ts`, `repository`/`homepage`/`bugs` em
   `package.json` e os links de `README`/`CONTRIBUTING`/`RELEASING` apontam para
   `rogeriomr/lighthouse-for-etherfi-cash`. Um fork precisa trocar esses arquivos.

## 5. Mover para fora do OneDrive

> **Ainda pendente em 21/10/2026:** o projeto continua no Desktop sincronizado pelo OneDrive. O repositório e o
> histórico já foram publicados, mas mover a pasta continua recomendado para tirar o `.git` da sincronização.

```powershell
# copia sem node_modules, dist, .claude e logs; ajuste o destino se quiser
robocopy "$env:USERPROFILE\OneDrive\Área de Trabalho\etherfi\etherfi-dashboard" "C:\dev\lighthouse-for-etherfi-cash" /E /XD node_modules dist .claude /XF *.log
```

Depois, na pasta nova:

```powershell
npm ci
node scripts/data-dir.mjs   # deve continuar apontando para %USERPROFILE%\lighthouse-data
npm run privacy             # 0 GRAVE e 0 aviso
npm run typecheck
npm run lint
npm run build
npm test
```

Só continue quando os cinco passarem **na pasta nova**. A pasta antiga pode ser apagada depois do primeiro push
(confira a lixeira e as versões do OneDrive, como no passo 1 do `RELEASING.md`).

## 6. Pré-voo do primeiro commit

```powershell
git init -b main
git config user.name "rogeriomr"
git config user.email "<id>+rogeriomr@users.noreply.github.com"   # veja github.com/settings/emails

git add -n .                  # simulação: o que entraria
git status --ignored --short  # "!!" = ignorado
git check-ignore -v fixtures/live/ fixtures/.pull-client.json dist/ node_modules/ .claude/
```

Confira na lista do `git add -n .`:

- nenhum `fixtures/live/`, `.pull-client.json`, `.env*`, `*.local.json`, `dist/`, `node_modules/`, `.claude/`,
  `*.log`, `*.tsbuildinfo`, `.ics`, `.csv`, `.har`, `.zip`;
- em `fixtures/`, somente `fixtures/sample/`;
- na raiz, somente os JSON do projeto (`package.json`, `package-lock.json`, `tsconfig.json`, `vercel.json`).

Se algo indesejado aparecer, **pare** e ajuste o `.gitignore` — não confie em apagar no commit seguinte.

```powershell
git add .
git commit -m "Lighthouse for ether.fi Cash 0.1.0"
git log -1 --format='%an <%ae>'   # precisa mostrar o e-mail noreply
```

## 7. Primeiro push

```powershell
gh auth login
git remote add origin https://github.com/rogeriomr/lighthouse-for-etherfi-cash.git
git push -u origin main
```

O repositório remoto já foi criado (público e vazio); o `--source .` do `gh repo create` falha agora porque o repo
existe. Se estiver recriando do zero, troque as duas últimas linhas por
`gh repo create rogeriomr/lighthouse-for-etherfi-cash --public --source . --remote origin`.

O push dispara o CI (Node 22.23.4 e Node 24.22.1). Só siga para a blindagem depois de os dois jobs ficarem verdes.

> **Já executado neste repositório (21/10/2026).** O primeiro push saiu por uma deploy key de escrita porque o token
> do `gh` não tinha o escopo `workflow` (o GitHub recusa criar/atualizar `.github/workflows/ci.yml` por OAuth App sem
> esse escopo). Para um clone novo, o fluxo acima continua valendo; se bater no mesmo bloqueio, use
> `gh auth refresh -h github.com -s workflow` ou uma deploy key de escrita.

## 8. Blindagem do repositório

Em *Settings → Code security* (ou pelos comandos do `RELEASING.md`):

- [x] Private vulnerability reporting (o `SECURITY.md` aponta para lá).
- [x] Secret scanning **com push protection**.
- [x] Dependabot alerts e security updates (o `.github/dependabot.yml` já agenda atualizações de versão).
- [ ] **Pendente:** 2FA/passkey na conta; códigos de recuperação guardados fora do navegador.
- [x] `main` protegida: checks **Node 22.23.4** e **Node 24.22.1** obrigatórios, sem force push e sem deleção.
- [x] `enforce_admins` decidido: `false` (projeto solo; ver seção 4).
- [x] CODEOWNERS cobre `package.json`, lockfile, config de deploy, `scripts/` e os módulos sensíveis
      (`oauth.ts`, `mcp.ts`, `storage.ts`, `normalize.ts`).

## 9. Deploy e release

- Deploy estático: Vercel (lê `vercel.json`), Netlify ou Cloudflare Pages (leem `public/_headers`). Os dois arquivos
  têm os mesmos cabeçalhos (CSP, HSTS, `no-referrer`, `frame-ancestors 'none'`, Trusted Types); mude os dois juntos.
- Não há segredo de servidor. `VITE_CONNECTOR_CORS=1` é opcional e só liga a conexão direta quando a ether.fi liberar
  a origem; sem isso, o caminho é `npm run pull` + importar.
- Prefira um domínio/origem dedicado ao painel: outras páginas na mesma origem conseguem ler o armazenamento local.
- Release: datas no `CHANGELOG.md`, tag anotada e `gh release create` (seção "Cutting a release" do `RELEASING.md`).
  Prints e notas de release saem **somente** do demo ou das fixtures.

## 10. Se algo vazar

1. **Dado financeiro em commit**: trate como permanente. Se o push acabou de acontecer e não há forks, reescreva o
   histórico e faça force push (desligue a proteção da `main` só durante a operação); mesmo assim, abra um chamado no
   GitHub para limpar caches/views. Avise quem puder ter clonado. Se já houver forks, o dado está fora do seu
   controle: rotacione o que der (endereço de depósito não rotaciona; tokens e chaves, sim).
2. **Token OAuth**: revogue em *Settings → AI Connections* no app da ether.fi; o "Desconectar" do painel só limpa a
   cópia local.
3. **Conta do GitHub comprometida**: revogue sessões, troque senha, reemita 2FA e códigos de recuperação, audite
   deploy keys, tokens, Actions e releases; desfaça releases maliciosas e publique um aviso.
4. **Depois de qualquer incidente**: adicione o padrão ao `.gitignore`, acrescente o caso ao `privacy-scan` e rode
   `npm run privacy` de novo antes de continuar.

## 11. Checklist final

- [ ] **Pendente:** projeto fora do OneDrive/iCloud/Dropbox, checks verdes na pasta nova.
- [ ] **Pendente:** 2FA/passkey + e-mail private + bloqueio de push que expõe e-mail.
- [x] `npm run privacy` = 0 GRAVE e 0 aviso fora da allowlist.
- [x] `git add -n .` sem dados, exports, segredos, build ou ferramentas.
- [x] Primeiro commit com autor noreply.
- [x] Repositório público criado; CI verde nos dois Nodes.
- [x] Secret scanning + push protection, relato privado, Dependabot.
- [x] `main` protegida com os checks e sem force push; `enforce_admins: false`.
- [x] Prints conferidos a olho (selo "demo").
- [ ] **Pendente:** release v0.1.0 com notas e prints do demo.
