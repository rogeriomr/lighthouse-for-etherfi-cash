# Lighthouse and your AI

🇧🇷 [Em português](#em-português)

Lighthouse never calls an AI and never sends your data anywhere. This folder prepares the ground for **your own AI**: the one that already knows you, maybe your spending too. With it, the AI can explain your numbers, run its own analyses with the same math as the screen, and change Lighthouse to fit you.

| File | What's in it |
|---|---|
| [earnings.md](earnings.md) | How Earnings is worked out: yield, cashback bands, the receipt, what the earnings pay, milestones, the 50/75/100% amounts, the notices. |
| [presets.md](presets.md) | Ready-made requests: explain my month, what if, cashback X-ray, plans side by side, subscription check-up, monthly check-in, make it yours, connector only. |
| [sources.md](sources.md) | What's worth reading at ether.fi, and the public APIs (APY history, ETHFI price, PTAX). |
| [../ai-prompts.md](../ai-prompts.md) | The request for the subscription files read from email, in a session that can't send. |
| [../../AGENTS.md](../../AGENTS.md) | For coding agents in this repository: the map, the commands, the privacy rules and the red lines. |

## Three ways in

1. **Your AI in the repository** (Claude Code, Codex, Cursor…). It reads `AGENTS.md` by itself, and Claude Code also loads the `lighthouse-earnings` skill (`.claude/skills/`). It runs `npm run earnings` to get the screen's numbers, as Markdown or JSON, with scenarios (`--extra-liquid`, `--apy`), and `--changes --save` for the monthly notices.
2. **A chat AI** (ChatGPT, Claude…). On **Earnings → Take it to your AI**, copy the month's sum as text and paste it with a request from [presets.md](presets.md). Pasting shares those numbers with that service.
3. **The ether.fi connector** connected to your AI. It reads your account directly, read only. Give it the formulas in [earnings.md](earnings.md), and request 8 in [presets.md](presets.md).

---

## Em português

O Lighthouse nunca chama uma IA e nunca manda os seus dados para lugar nenhum. Esta pasta prepara o terreno para a **sua própria IA**: a que já conhece você, e talvez os seus gastos. Com ela, a IA consegue explicar os seus números, fazer as próprias análises com a mesma conta da tela e mudar o Lighthouse para o seu jeito.

| Arquivo | O que tem |
|---|---|
| [earnings.md](earnings.md#em-português) | Como a tela Ganhos é calculada: rendimento, faixas de cashback, o recibo, o que os ganhos pagam, os marcos, os valores para 50/75/100% e os avisos. |
| [presets.md](presets.md#em-português) | Pedidos prontos: explicar o mês, "e se", raio-X do cashback, planos lado a lado, revisão das assinaturas, revisão do mês, deixar com a sua cara e só com o conector. |
| [sources.md](sources.md#em-português) | O que vale ler na ether.fi e as APIs públicas (histórico do APY, preço do ETHFI, PTAX). |
| [../ai-prompts.md](../ai-prompts.md#em-português) | O pedido dos arquivos de assinaturas lidos do email, numa sessão que não consegue enviar. |
| [../../AGENTS.md](../../AGENTS.md) | Para agentes de código neste repositório: o mapa, os comandos, as regras de privacidade e as linhas vermelhas. |

### Três jeitos de usar

1. **A sua IA no repositório** (Claude Code, Codex, Cursor…).
   - Ela lê o `AGENTS.md` sozinha, e o Claude Code também carrega a skill `lighthouse-earnings` (`.claude/skills/`).
   - Com `npm run earnings`, ela pega os números da tela, em Markdown ou JSON, com cenários (`--extra-liquid`, `--apy`).
   - Com `--changes --save`, faz os avisos do mês.
2. **Uma IA de chat** (ChatGPT, Claude…). Em **Ganhos → Leve para a sua IA**, copie a conta do mês em texto e cole com um pedido do [presets.md](presets.md#em-português). Colar compartilha esses números com o serviço.
3. **O conector da ether.fi** ligado à sua IA. Ele lê a sua conta direto, só leitura. Dê a ele as fórmulas do [earnings.md](earnings.md#em-português) e use o pedido 8 do [presets.md](presets.md#em-português).
