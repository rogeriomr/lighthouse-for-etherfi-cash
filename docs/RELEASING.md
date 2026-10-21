# Releasing

🇧🇷 [Em português](#em-português)

How to publish the repository for the first time and cut a release. The commands assume the GitHub account `rogeriomr` and the repository `rogeriomr/lighthouse-for-etherfi-cash` (the same as `REPO_URL` in `src/lib/config.ts` and `repository` in `package.json`); a fork changes those three places.

For the context behind these steps (what is published, what must never enter git, decisions that are yours and what to do if something leaks), see [`PUBLISHING.md`](PUBLISHING.md).

## Before the first public push

A push is forever: GitHub keeps every commit, and forks and caches copy them. Do these in order.

### 1. Your data stays out

- [ ] `npm run privacy` exits **0** on the machine that has your real data (the data folder of `scripts/data-dir.mjs`): no GRAVE finding and no warning outside `scripts/privacy-allow.json`.
- [ ] Your real files are **not in a cloud-synced folder** (OneDrive, iCloud Drive, Dropbox, Google Drive) nor in the project. Create `%USERPROFILE%\lighthouse-data` (Windows) or `~/lighthouse-data` (macOS, Linux), move into it everything from `fixtures/live/` (and `fixtures/.pull-client.json`, if it is there), and check that `node scripts/data-dir.mjs` shows it. Then empty the cloud copy too, including its recycle bin and file versions.
- [ ] `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run check` pass.

### 2. A git identity that doesn't expose your email

The global git identity on this machine is a placeholder ("Your Name"). Use your GitHub **noreply** address in this repository; it is on <https://github.com/settings/emails> (`<id>+rogeriomr@users.noreply.github.com`). On that page also turn on **Keep my email addresses private** and **Block command line pushes that expose my email**.

```bash
git init -b main
git config user.name "rogeriomr"
git config user.email "<id>+rogeriomr@users.noreply.github.com"
```

### 3. Check what would be committed

```bash
git add -n .                 # dry run: lists every file that would go in
git status --ignored --short # "!!" = ignored
git check-ignore -v fixtures/live/ fixtures/.pull-client.json dist/ node_modules/ .claude/
```

- [ ] The list from `git add -n .` has **no** `fixtures/live/`, `fixtures/.pull-client.json`, `dist/`, `node_modules/`, `.claude/`, `*.tsbuildinfo`, `.env*`, `*.local.json`, logs, `.ics`/`.csv`/`.har` exports, screenshots of a real account or files from `npm run pull`. In `fixtures/` only `fixtures/sample/` goes in, and at the root only the project's own JSON (`package.json`, `package-lock.json`, `tsconfig.json`, `vercel.json`).
- [ ] `git check-ignore -v` names a `.gitignore` rule for each of those paths.
- [ ] If you ever deploy with the Vercel CLI from this folder (`vercel deploy`), `.vercelignore` is what keeps the data out: the CLI does not read `.gitignore`.

Then make the first commit and check its author:

```bash
git add .
git commit -m "Lighthouse for ether.fi Cash 0.1.0"
git log -1 --format='%an <%ae>'   # must show the noreply address
```

### 4. Add the remote and push

The repository already exists (public and empty), so add it as the remote:

```bash
gh auth login
git remote add origin https://github.com/rogeriomr/lighthouse-for-etherfi-cash.git
git push -u origin main
```

If you are creating a new repository from scratch instead, use
`gh repo create rogeriomr/lighthouse-for-etherfi-cash --public --source . --remote origin` and then the same push.

### 5. Turn on the security features

In *Settings → Code security* (or with the commands below):

- [ ] **Private vulnerability reporting** (SECURITY.md points to it).
- [ ] **Secret scanning** with **push protection**.
- [ ] **Dependabot alerts** and **Dependabot security updates** (`.github/dependabot.yml` already schedules version updates).

```bash
R=rogeriomr/lighthouse-for-etherfi-cash
gh api -X PUT repos/$R/private-vulnerability-reporting
gh api -X PATCH repos/$R -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
gh api -X PUT repos/$R/vulnerability-alerts
gh api -X PUT repos/$R/automated-security-fixes
```

### 6. Protect `main` and require the CI

Wait for the first CI run to finish green (*Actions* tab): its two jobs are named **Node 22.23.4** and **Node 24.22.1**. Then:

```bash
gh api -X PUT repos/$R/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["Node 22.23.4", "Node 24.22.1"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

- [ ] A test PR shows "Required" next to both checks.

### 7. Description and topics

Topics help people find it and keep it apart from the other projects called Lighthouse:

```bash
gh repo edit $R --homepage "https://github.com/$R#readme" \
  --add-topic ether-fi --add-topic ether-fi-cash --add-topic crypto-card --add-topic personal-finance \
  --add-topic budgeting --add-topic subscriptions --add-topic mcp --add-topic client-side \
  --add-topic privacy-first --add-topic react --add-topic typescript --add-topic vite
```

- [ ] Optional: *Settings → Social preview* with `docs/screenshots/portfolio-desktop.png` (demo, fictional data).

## Cutting a release

1. In [`CHANGELOG.md`](../CHANGELOG.md), give the version its date (for 0.1.0, replace "unreleased" with today's date). `package.json` already says 0.1.0; for later versions, `npm version <x.y.z> --no-git-tag-version` updates it and the lock together.
2. Run the checks of step 1 again, including `npm run privacy`.
3. Commit, tag and publish:

```bash
git commit -am "Release 0.1.0"
git tag -a v0.1.0 -m "Lighthouse for ether.fi Cash 0.1.0"
git push origin main v0.1.0
gh release create v0.1.0 --title "Lighthouse for ether.fi Cash 0.1.0" --notes "See CHANGELOG.md for what changed."
```

Release notes and screenshots come only from the demo or the synthetic fixtures, never from a real account.

## Em português

Lista do dono para o primeiro push público, na ordem:

1. **Dados de fora:** `npm run privacy` sai com **0** na máquina que tem os dados reais; os arquivos reais **não** ficam em pasta sincronizada com a nuvem nem no projeto (crie `%USERPROFILE%\lighthouse-data`, mova para ela tudo de `fixtures/live/` e o `fixtures/.pull-client.json`, confira com `node scripts/data-dir.mjs` e esvazie a cópia da nuvem, inclusive lixeira e versões); `npm ci`, `typecheck`, `lint`, `build` e `check` passam.
2. **Identidade do git:** o git global desta máquina está com "Your Name". Neste repositório, use o email **noreply** do GitHub (em <https://github.com/settings/emails>, no formato `<id>+rogeriomr@users.noreply.github.com`) e ligue lá **Keep my email addresses private** e **Block command line pushes that expose my email**. Comandos no passo 2 acima.
3. **Conferir o que entra:** `git add -n .`, `git status --ignored --short` e `git check-ignore -v …` (passo 3). Nada de `fixtures/live/`, `fixtures/.pull-client.json`, `dist/`, `node_modules/`, `.claude/`, `*.tsbuildinfo`, `.env*`, `*.local.json`, exportações `.ics`/`.csv`/`.har` nem prints de conta real; em `fixtures/` só entra `fixtures/sample/`. Deploy pela CLI da Vercel a partir desta pasta depende do `.vercelignore` (a CLI não lê o `.gitignore`). Depois do 1º commit, `git log -1 --format='%an <%ae>'` tem de mostrar o noreply.
4. **Enviar:** o repositório remoto já existe (público e vazio): `git remote add origin https://github.com/rogeriomr/lighthouse-for-etherfi-cash.git` e `git push -u origin main` (passo 4).
5. **Segurança:** relato privado de vulnerabilidade, secret scanning com push protection, alertas e atualizações de segurança do Dependabot (passo 5).
6. **Proteger a `main`:** depois do 1º CI verde, exigir os checks **Node 22.23.4** e **Node 24.22.1** (passo 6).
7. **Descrição e tópicos** (passo 7), e, se quiser, a imagem de prévia com a captura do demo.
8. **Release v0.1.0:** passar o "Unreleased" do CHANGELOG para a versão com a data, conferir tudo de novo, `git tag -a v0.1.0`, `git push origin main v0.1.0` e `gh release create v0.1.0` (seção "Cutting a release").
