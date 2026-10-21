// Os cartões de economia que dependem de preço de tabela público ou de regra com fonte: canal (loja de apps × site),
// moeda (BRL × USD), anual × mensal, assinaturas sobrepostas, clubes, reajuste anunciado e DCC provável. Os dados
// (preços, regras, fontes) são do priceBook.ts e do savingsRules.ts; aqui fica a detecção e o texto.
// Linha vermelha: só serviço com preço de tabela; nada de "mais barato em outro lugar" para loja, restaurante ou
// produto; nenhum cálculo de imposto; nada de link de afiliado. Toda conta com preço de tabela é Estimativa.

import { isBalanceTopUp, isCharge, monthComparable, recentFx } from '../analytics.ts';
import { dateShort, daysAgo, money, pct, usd } from '../format.ts';
import { localized, pick, type Locale } from '../locale.ts';
import { categoryLabel } from '../merchants.ts';
import { analyzeSubscriptions, knowledgeFor, subscriptionKey } from '../subscriptions.ts';
import type { SubscriptionRecord } from '../subscriptionTypes';
import type { Dataset, Transaction } from '../types';
import { PRICE_BOOK, PRICE_CHANGES, PRICE_STALE_DAYS, type Country, type PriceEntry, type PriceSource } from './priceBook.ts';
import { ANNUAL_TRAPS, BUNDLE_OVERLAPS, CLUBS, DCC, SERVICE_GROUPS, TINY_TERM_SAVING, type ServiceGroup } from './savingsRules.ts';
import type { InsightCard, InsightOptions, InsightSource } from './types';

type Tr = (en: string, pt: string) => string;

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;
/** Cobrança e preço de tabela "batem" quando a diferença fica em 1% (ou 10 centavos) */
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.1, Math.abs(b) * 0.01);

const CATEGORY_CASHBACK: InsightSource = {
  label: 'ether.fi · How does Category Cashback work?',
  url: 'https://help.ether.fi/en/articles/823083-how-does-category-cashback-work',
  checked: '2026-10-19',
};

/** Data no fim da frase: em pt o dateShort já termina em ponto ("27 de mar."), e o ponto final não se repete */
const endDate = (iso: string) => dateShort(iso).replace(/\.$/, '');
const countryOf = (home: string | undefined): Country | null => (home === 'BRL' ? 'BR' : home === 'USD' ? 'US' : null);
const fresh = (e: { source: PriceSource }, ref: string) => daysAgo(e.source.checked.slice(0, 10), ref) <= PRICE_STALE_DAYS;
/** A fonte para a tela, com o nível (imprensa ganha selo) e o dia do texto de imprensa */
const src = (s: PriceSource): InsightSource => ({ label: s.label, url: s.url, checked: s.checked, level: s.level, ...(s.published ? { published: s.published } : {}) });

/** O plano da tabela que bate com a última cobrança (mesma moeda; mensal no ciclo mensal, o prazo de 12 meses no anual) */
function matchEntry(r: SubscriptionRecord, ref: string): PriceEntry | undefined {
  const key = subscriptionKey(r.name);
  const { amount, currency } = r.lastCharge;
  return PRICE_BOOK.find((e) => e.service === key && e.currency === currency && fresh(e, ref) && (
    r.cycle === 'monthly' ? e.monthly !== undefined && sameAmount(amount, e.monthly)
      : r.cycle === 'annual' ? (e.terms ?? []).some((t) => t.months === 12 && sameAmount(amount, t.total))
        : false));
}

function activeSubscriptions(dataset: Dataset, opts: InsightOptions, locale: Locale): SubscriptionRecord[] {
  const records = opts.subscriptions
    ?? analyzeSubscriptions(dataset, { knowledge: knowledgeFor(dataset), today: dataset.referenceDate, locale }).records;
  return records.filter((r) => r.status === 'active' && r.kind === 'subscription');
}

// ---------- canal e moeda ----------

function channelCards(subs: SubscriptionRecord[], dataset: Dataset, tr: Tr, locale: Locale): InsightCard[] {
  const out: InsightCard[] = [];
  const ref = dataset.referenceDate;
  const fx = recentFx(dataset);
  for (const r of subs) {
    if (r.cycle !== 'monthly') continue;
    const e = matchEntry(r, ref);
    if (!e) continue;
    const key = subscriptionKey(r.name);
    const planName = localized(e.planName, locale) ?? e.plan;
    // a mesma assinatura vendida direto pelo serviço (outro canal, qualquer moeda)
    const direct = PRICE_BOOK.find((d) => d.service === key && d.plan === e.plan && d.channel === 'direct' && d.monthly !== undefined && fresh(d, ref));
    if (e.channel === 'app_store' && direct) {
      const inHome = direct.currency === e.currency ? direct.monthly! : fx && direct.currency === 'USD' && fx.currency === e.currency ? direct.monthly! * fx.localPerUsd : null;
      if (inHome === null) continue;
      const diff = e.monthly! / inHome - 1;
      if (diff <= 0.02) continue;
      out.push({
        id: `price-channel-${key}`,
        group: 'savings',
        origin: 'local',
        estimate: true,
        title: tr(`${e.serviceName}: app store vs direct`, `${e.serviceName}: loja de apps × direto`),
        body: tr(
          `Your ${e.serviceName} ${planName} charge (${money(r.lastCharge.amount, r.lastCharge.currency)}) matches the app store price. ${e.serviceName}’s own ${direct.country === 'US' && e.country !== 'US' ? 'US ' : ''}site lists the same plan at ${money(direct.monthly!, direct.currency)}${direct.note ? ` (${localized(direct.note, 'en')?.replace(/\.$/, '').toLowerCase()})` : ''}${direct.currency !== e.currency ? `, about ${money(inHome, e.currency)} at your recent card rate` : ''}: about ${pct(diff * 100)} less. Subscriptions billed through an app store don’t earn ether.fi’s Category Cashback bonus.`,
          `A sua cobrança do ${e.serviceName} ${planName} (${money(r.lastCharge.amount, r.lastCharge.currency)}) bate com o preço da loja de apps. O site do ${e.serviceName}${direct.country === 'US' && e.country !== 'US' ? ' nos EUA' : ''} lista o mesmo plano a ${money(direct.monthly!, direct.currency)}${direct.note ? ` (${localized(direct.note, 'pt')?.replace(/\.$/, '').toLowerCase()})` : ''}${direct.currency !== e.currency ? `, cerca de ${money(inHome, e.currency)} pelo seu câmbio recente` : ''}: cerca de ${pct(diff * 100)} a menos. Assinatura cobrada pela loja de apps não ganha o bônus de Category Cashback da ether.fi.`,
        ),
        facts: [
          { label: tr('App store (your charge)', 'Loja de apps (a sua cobrança)'), value: money(e.monthly!, e.currency) },
          { label: tr('Direct, listed price', 'Direto, preço de tabela'), value: money(direct.monthly!, direct.currency), estimate: true },
          ...(direct.currency !== e.currency ? [{ label: tr('Direct, in your currency', 'Direto, na sua moeda'), value: money(inHome, e.currency), estimate: true }] : []),
        ],
        why: tr(
          `The last charge matches the app store price in the price list (within 1%). Direct price from ${direct.source.label}, checked on ${direct.source.checked}${direct.note ? ` (${localized(direct.note, 'en')})` : ''}.${direct.currency !== e.currency && fx ? ` Converted at your card’s rate over your last ${fx.count} purchases in ${fx.currency}.` : ''} Listed prices can change.`,
          `A última cobrança bate com o preço da loja de apps na base de preços (até 1%). O preço direto é de ${direct.source.label}, conferido em ${direct.source.checked}${direct.note ? ` (${localized(direct.note, 'pt')})` : ''}.${direct.currency !== e.currency && fx ? ` Convertido pelo câmbio do seu cartão nas últimas ${fx.count} compras em ${fx.currency}.` : ''} Preço de tabela pode mudar.`,
        ),
        relatedIds: r.charges.slice(-6).map((t) => t.id),
        sources: [src(e.source), src(direct.source), CATEGORY_CASHBACK],
      });
    } else if (e.channel === 'direct' && fx && e.currency === fx.currency && e.currency !== 'USD') {
      // a mesma assinatura também tem preço em dólar: o ponto de equilíbrio é o câmbio da própria pessoa
      const usdPrice = PRICE_BOOK.find((d) => d.service === key && d.plan === e.plan && d.currency === 'USD' && d.monthly !== undefined && fresh(d, ref));
      if (!usdPrice) continue;
      const breakEven = e.monthly! / usdPrice.monthly!;
      out.push({
        id: `price-currency-${key}`,
        group: 'savings',
        origin: 'local',
        estimate: true,
        title: tr(`${e.serviceName}: in ${e.currency} or in dollars`, `${e.serviceName}: em ${e.currency} ou em dólar`),
        body: tr(
          `${e.serviceName} ${planName} costs ${money(e.monthly!, e.currency)} or ${money(usdPrice.monthly!, 'USD')}. Paying in ${e.currency} only comes out ahead while ${money(1, 'USD', { compact: true })} costs more than ${money(breakEven, e.currency)} on your card; recently it cost ${money(fx.localPerUsd, e.currency)}.`,
          `O ${e.serviceName} ${planName} custa ${money(e.monthly!, e.currency)} ou ${money(usdPrice.monthly!, 'USD')}. Pagar em ${e.currency} só sai na frente enquanto ${money(1, 'USD', { compact: true })} custar mais que ${money(breakEven, e.currency)} no seu cartão; recentemente custou ${money(fx.localPerUsd, e.currency)}.`,
        ),
        facts: [
          { label: tr(`Listed in ${e.currency}`, `Tabela em ${e.currency}`), value: money(e.monthly!, e.currency), estimate: true },
          { label: tr('Listed in USD', 'Tabela em US$'), value: money(usdPrice.monthly!, 'USD'), estimate: true },
          { label: tr('Break-even rate', 'Câmbio de equilíbrio'), value: money(breakEven, e.currency), estimate: true },
          { label: tr('Your recent card rate', 'O seu câmbio recente'), value: money(fx.localPerUsd, e.currency), estimate: true },
        ],
        why: tr(
          `Break-even = price in ${e.currency} ÷ price in USD. Your rate = ${fx.currency} ÷ USD over your last ${fx.count} settled purchases in ${fx.currency} (${fx.from} to ${fx.to}); it already includes the card’s conversion cost. Prices from the public price list, checked on ${e.source.checked} and ${usdPrice.source.checked}.`,
          `Equilíbrio = preço em ${e.currency} ÷ preço em US$. O seu câmbio = ${fx.currency} ÷ US$ nas últimas ${fx.count} compras liquidadas em ${fx.currency} (${fx.from} a ${fx.to}); ele já inclui o custo de conversão do cartão. Preços da base pública, conferidos em ${e.source.checked} e ${usdPrice.source.checked}.`,
        ),
        relatedIds: r.charges.slice(-6).map((t) => t.id),
        sources: [src(e.source), src(usdPrice.source)],
      });
    }
  }
  return out;
}

// ---------- anual × mensal ----------

function annualCards(subs: SubscriptionRecord[], dataset: Dataset, tr: Tr, locale: Locale): InsightCard[] {
  const out: InsightCard[] = [];
  const ref = dataset.referenceDate;
  const country = countryOf(dataset.homeCurrency);
  for (const r of subs) {
    if (r.cycle !== 'monthly') continue;
    const e = matchEntry(r, ref);
    if (!e || e.monthly === undefined || e.noAnnual) continue;
    const term = (e.terms ?? []).filter((t) => t.months === 12).sort((a, b) => a.total - b.total)[0];
    if (!term) continue;
    const key = subscriptionKey(r.name);
    const saving = 1 - term.total / (12 * e.monthly);
    const traps = ANNUAL_TRAPS.filter((t) => t.service === key && (!t.plan || t.plan === e.plan) && (!country || t.country === country));
    const planName = localized(e.planName, locale) ?? e.plan;
    const months = r.charges.filter((t) => t.amountUsd > 0).length;
    const head = saving >= TINY_TERM_SAVING
      ? tr(`The 12-month ${planName} plan totals ${money(term.total, e.currency)}, ${pct(saving * 100)} less than 12 monthly payments (${money(12 * e.monthly, e.currency)}).`,
        `O plano ${planName} de 12 meses sai ${money(term.total, e.currency)}, ${pct(saving * 100)} abaixo de 12 mensalidades (${money(12 * e.monthly, e.currency)}).`)
      : saving >= 0
        ? tr(`The 12-month ${planName} plan totals ${money(term.total, e.currency)}, almost the same as 12 monthly payments (${money(12 * e.monthly, e.currency)}).`,
          `O plano ${planName} de 12 meses sai ${money(term.total, e.currency)}, quase o mesmo que 12 mensalidades (${money(12 * e.monthly, e.currency)}).`)
        : tr(`The 12-month ${planName} plan totals ${money(term.total, e.currency)}, more than 12 monthly payments (${money(12 * e.monthly, e.currency)}).`,
          `O plano ${planName} de 12 meses sai ${money(term.total, e.currency)}, mais que 12 mensalidades (${money(12 * e.monthly, e.currency)}).`);
    out.push({
      id: `plan-annual-${key}`,
      group: 'savings',
      origin: 'local',
      estimate: true,
      title: tr(`${e.serviceName}: monthly or 12 months`, `${e.serviceName}: mensal ou 12 meses`),
      body: [
        tr(`You’ve paid ${months} monthly charges in a row. `, `Você pagou ${months} mensalidades seguidas. `),
        head,
        // regra do preço que a conta não mostra (ex.: "sem os impostos aplicáveis")
        e.note ? ` ${localized(e.note, locale) ?? ''}` : '',
        ...traps.map((t) => ` ${localized(t.text, locale) ?? ''}`),
      ].join(''),
      facts: [
        { label: tr('Monthly (listed)', 'Mensal (tabela)'), value: money(e.monthly, e.currency), estimate: true },
        { label: tr('12 months (listed)', '12 meses (tabela)'), value: money(term.total, e.currency), estimate: true },
        { label: tr('Difference over 12 months', 'Diferença em 12 meses'), value: money(R2(12 * e.monthly - term.total), e.currency), estimate: true },
      ],
      why: tr(
        `Saving = 1 − 12-month total ÷ (12 × monthly), with the listed prices for the plan that matches your last charge. How the 12 months are billed: ${term.billing === 'prepaid' ? 'paid upfront, doesn’t renew' : term.billing === 'installments' ? 'in monthly installments' : 'upfront'}. Prices from ${e.source.label}, checked on ${e.source.checked}.`,
        `Economia = 1 − total de 12 meses ÷ (12 × mensal), pelos preços de tabela do plano que bate com a sua última cobrança. Como os 12 meses são cobrados: ${term.billing === 'prepaid' ? 'pagos adiantado, sem renovação' : term.billing === 'installments' ? 'em parcelas mensais' : 'à vista'}. Preços de ${e.source.label}, conferidos em ${e.source.checked}.`,
      ),
      relatedIds: r.charges.slice(-12).map((t) => t.id),
      sources: [src(e.source), ...traps.map((t) => src(t.source))],
    });
  }
  return out;
}

// ---------- sobreposição ----------

const GROUP_NAME: Record<ServiceGroup, [en: string, pt: string]> = {
  ai_assistant: ['AI assistant', 'assistentes de IA'],
  video: ['video streaming', 'streaming de vídeo'],
  music: ['music streaming', 'streaming de música'],
  cloud_storage: ['cloud storage', 'armazenamento na nuvem'],
};

function overlapCards(subs: SubscriptionRecord[], dataset: Dataset, tr: Tr, locale: Locale): InsightCard[] {
  const out: InsightCard[] = [];
  const ref = dataset.referenceDate;
  const country = countryOf(dataset.homeCurrency);
  const byGroup = new Map<ServiceGroup, SubscriptionRecord[]>();
  for (const r of subs) {
    const g = SERVICE_GROUPS[subscriptionKey(r.name)];
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  for (const [g, list] of byGroup) {
    if (list.length < 2) continue;
    const total = R2(list.reduce((s, r) => s + r.monthlyCostUsd, 0));
    const name = pick(locale, ...GROUP_NAME[g]);
    const names = new Intl.ListFormat(locale === 'pt' ? 'pt-BR' : 'en', { type: 'conjunction' }).format(list.map((r) => r.name));
    const two = list.length === 2;
    out.push({
      id: `plan-overlap-${g}`,
      group: 'savings',
      origin: 'local',
      estimate: false,
      title: tr(`${list.length} ${name} subscriptions`, `${list.length} assinaturas de ${name}`),
      body: tr(
        `You pay for ${names}: ${usd(total)} a month together. Worth checking whether you use ${two ? 'both' : 'all of them'}.`,
        `Você paga ${names}: ${usd(total)} por mês juntos. Vale conferir se usa ${two ? 'os dois' : 'todos'}.`,
      ),
      facts: list.map((r) => ({ label: r.name, value: tr(`${usd(r.monthlyCostUsd)}/mo`, `${usd(r.monthlyCostUsd)}/mês`) })),
      why: tr(
        'Active subscriptions from the Subscriptions screen, grouped by kind of service. Cost a month = last charge in USD ÷ months in its cycle.',
        'Assinaturas ativas da tela Assinaturas, agrupadas pelo tipo de serviço. Custo por mês = última cobrança em US$ ÷ meses do ciclo.',
      ),
      relatedIds: list.map((r) => r.lastCharge.id),
    });
  }
  // um plano que já inclui outro serviço que a pessoa também paga
  for (const b of BUNDLE_OVERLAPS) {
    if (country && b.country && b.country !== country) continue;
    const bundle = subs.find((r) => subscriptionKey(r.name) === b.bundle);
    if (!bundle) continue;
    // o plano do pacote sai do valor da cobrança: é palpite ("parece ser"), e a Apple usa o mesmo descritor para tudo
    let guessed: string | null = null;
    if (b.bundlePlans) {
      const e = matchEntry(bundle, ref);
      if (!e || !b.bundlePlans.includes(e.plan)) continue;
      guessed = localized(e.planName, locale) ?? e.plan;
    }
    const others = subs.filter((r) => r !== bundle && (
      (b.includesService && subscriptionKey(r.name) === b.includesService)
      || (b.includesGroup && SERVICE_GROUPS[subscriptionKey(r.name)] === b.includesGroup)));
    for (const o of others) {
      out.push({
        id: `plan-bundle-${b.bundle}-${subscriptionKey(o.name)}`,
        group: 'savings',
        origin: 'local',
        estimate: false,
        title: tr(`${bundle.name} and ${o.name}`, `${bundle.name} e ${o.name}`),
        body: tr(
          `${guessed ? `By its amount, your ${bundle.name} charge looks like ${guessed}. ` : ''}${localized(b.text, 'en')} You also pay ${o.name} (${usd(o.monthlyCostUsd)} a month). Worth checking whether the two overlap for you.`,
          `${guessed ? `Pelo valor, a sua cobrança de ${bundle.name} parece ser do ${guessed}. ` : ''}${localized(b.text, 'pt')} Você também paga ${o.name} (${usd(o.monthlyCostUsd)} por mês). Vale conferir se os dois se sobrepõem no seu caso.`,
        ),
        facts: [
          { label: bundle.name, value: tr(`${usd(bundle.monthlyCostUsd)}/mo`, `${usd(bundle.monthlyCostUsd)}/mês`) },
          { label: o.name, value: tr(`${usd(o.monthlyCostUsd)}/mo`, `${usd(o.monthlyCostUsd)}/mês`) },
        ],
        why: tr(
          `What the plan includes comes from ${b.source.label}, checked on ${b.source.checked}${b.bundlePlans ? '; the plan is identified by the amount of your last charge' : ''}.`,
          `O que o plano inclui vem de ${b.source.label}, conferido em ${b.source.checked}${b.bundlePlans ? '; o plano sai do valor da sua última cobrança' : ''}.`,
        ),
        relatedIds: [bundle.lastCharge.id, o.lastCharge.id],
        sources: [src(b.source)],
      });
    }
  }
  // o mesmo serviço em duas cobranças recorrentes (dois canais ou duas contas)
  const byBrand = new Map<string, SubscriptionRecord[]>();
  for (const r of subs) if (r.brand) byBrand.set(r.brand, [...(byBrand.get(r.brand) ?? []), r]);
  for (const [brand, list] of byBrand) {
    if (list.length < 2) continue;
    out.push({
      id: `plan-twice-${subscriptionKey(brand)}`,
      group: 'savings',
      origin: 'local',
      estimate: false,
      title: tr(`${brand} charges twice`, `${brand} em duas cobranças`),
      body: tr(
        `${list.length} recurring charges from ${brand} are active: ${list.map((r) => `${r.name} ${usd(r.monthlyCostUsd)}/mo`).join(', ')}. It can be two accounts, two plans or two channels: worth checking.`,
        `${list.length} cobranças recorrentes de ${brand} estão ativas: ${list.map((r) => `${r.name} ${usd(r.monthlyCostUsd)}/mês`).join(', ')}. Pode ser duas contas, dois planos ou dois canais: vale conferir.`,
      ),
      facts: list.map((r) => ({ label: r.name, value: tr(`${usd(r.monthlyCostUsd)}/mo`, `${usd(r.monthlyCostUsd)}/mês`) })),
      why: tr('Active subscriptions from the Subscriptions screen with the same brand.', 'Assinaturas ativas da tela Assinaturas com a mesma marca.'),
      relatedIds: list.map((r) => r.lastCharge.id),
    });
  }
  return out;
}

// ---------- clubes ----------

function clubCards(subs: SubscriptionRecord[], dataset: Dataset, opts: InsightOptions, tr: Tr, locale: Locale): InsightCard[] {
  const out: InsightCard[] = [];
  const country = countryOf(dataset.homeCurrency);
  const home = dataset.homeCurrency;
  if (!country || !home) return out;
  const ref = dataset.referenceDate;
  // os 3 meses inteiros antes do corrente que o histórico cobre
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7);
    if (monthComparable(dataset, d)) months.push(d);
  }
  if (!months.length) return out;
  for (const rule of CLUBS) {
    if (rule.country !== country) continue;
    const rows = dataset.transactions.filter((t) => isCharge(t) && t.currency === home && t.brand === rule.spend.brand
      && t.category === rule.spend.category && months.includes(t.date.slice(0, 7)) && !(rule.spend.excludeTopUps && isBalanceTopUp(t)));
    const member = subs.find((r) => subscriptionKey(r.name) === rule.service);
    if (!rows.length && !member) continue;
    const perMonth = R2(rows.reduce((s, t) => s + t.amount, 0) / months.length);
    const entry = rule.priceId ? PRICE_BOOK.find((e) => e.id === rule.priceId && fresh(e, ref)) : undefined;
    const typed = opts.clubPrices?.[rule.service];
    const price = typeof typed === 'number' && typed > 0 ? typed : entry?.monthly;
    const name = entry?.serviceName ?? rule.service;
    let benefit: number;
    let breakEven: number | null = null;
    if (rule.benefit.kind === 'credit_rate') {
      benefit = R2(perMonth * rule.benefit.rate);
      if (price) breakEven = R2(price / rule.benefit.rate);
    } else {
      const { perMonth: n, rate, capPerUse } = rule.benefit;
      benefit = R2(months.reduce((s, m) => s + rows.filter((t) => t.date.slice(0, 7) === m).map((t) => Math.min(rate * t.amount, capPerUse))
        .sort((a, b) => b - a).slice(0, n).reduce((x, y) => x + y, 0), 0) / months.length);
    }
    const cat = categoryLabel(rule.spend.category, locale);
    out.push({
      id: `club-${rule.service}`,
      group: 'savings',
      origin: 'local',
      estimate: true,
      // a pessoa pode digitar o preço que paga (ou o que o app mostra para ela): clubPrices[subject]
      interactive: 'club-price',
      subject: rule.service,
      title: tr(`${name}: your real use`, `${name}: o seu uso real`),
      body: [
        tr(`${months.length === 1 ? 'Over the last full month' : `Over the last ${months.length} full months`} you spent about ${money(perMonth, home)} a month with ${rule.spend.brand} (${cat}).`, `${months.length === 1 ? 'No último mês inteiro' : `Nos últimos ${months.length} meses inteiros`}, você gastou cerca de ${money(perMonth, home)} por mês com ${rule.spend.brand} (${cat}).`),
        rule.benefit.kind === 'credit_rate'
          ? tr(` At ${pct(rule.benefit.rate * 100)} back in credit, that would be about ${money(benefit, home)} a month`, ` Com ${pct(rule.benefit.rate * 100)} de volta em crédito, seriam cerca de ${money(benefit, home)} por mês`)
          : tr(` The club’s coupons would be worth about ${money(benefit, home)} a month at that use`, ` Os cupons do clube valeriam cerca de ${money(benefit, home)} por mês nesse uso`),
        price
          ? tr(` against ${money(price, home)} for the club${breakEven !== null ? `; it breaks even at ${money(breakEven, home)} a month in spending` : ''}.`, ` contra ${money(price, home)} do clube${breakEven !== null ? `; o equilíbrio fica em ${money(breakEven, home)} por mês de gasto` : ''}.`)
          : tr('. The club price varies by person: enter yours to compare.', '. O preço do clube varia por pessoa: digite o seu para comparar.'),
        member ? tr(' You already subscribe.', ' Você já assina.') : '',
        // fonte só de imprensa: o texto diz isso, além do selo da fonte
        rule.sources.every((s) => s.level === 'press')
          ? tr(
            ` This club’s rules come from the press (${rule.sources.map((s) => `${s.label}${s.published ? `, ${s.published}` : ''}`).join('; ')}), not from an official page.`,
            ` As regras deste clube vêm da imprensa (${rule.sources.map((s) => `${s.label}${s.published ? `, ${s.published}` : ''}`).join('; ')}), não de uma página oficial.`,
          )
          : '',
      ].join(''),
      note: rule.caveats.map((c) => localized(c, locale) ?? '').join(' '),
      facts: [
        { label: tr(`${rule.spend.brand} a month`, `${rule.spend.brand} por mês`), value: money(perMonth, home) },
        { label: tr('Estimated benefit a month', 'Benefício estimado por mês'), value: money(benefit, home), estimate: true },
        ...(price ? [{ label: tr(typed ? 'Club price (you entered)' : 'Club price (listed)', typed ? 'Preço do clube (você digitou)' : 'Preço do clube (tabela)'), value: money(price, home), estimate: !typed }] : []),
        ...(breakEven !== null ? [{ label: tr('Break-even spending', 'Gasto de equilíbrio'), value: money(breakEven, home), estimate: true }] : []),
      ],
      why: [
        rule.benefit.kind === 'credit_rate'
          ? tr(`Benefit = spending × ${pct(rule.benefit.rate * 100)}; break-even = club price ÷ ${pct(rule.benefit.rate * 100)}.`, `Benefício = gasto × ${pct(rule.benefit.rate * 100)}; equilíbrio = preço do clube ÷ ${pct(rule.benefit.rate * 100)}.`)
          : tr(`Benefit = the ${rule.benefit.perMonth} largest discounts a month, each ${pct(rule.benefit.rate * 100)} of the order up to ${money(rule.benefit.capPerUse, home)}.`, `Benefício = os ${rule.benefit.perMonth} maiores descontos do mês, cada um ${pct(rule.benefit.rate * 100)} do pedido até ${money(rule.benefit.capPerUse, home)}.`),
        tr(` Spending = card purchases in ${home} with ${rule.spend.brand} in ${cat}, refunds left out.`, ` Gasto = compras no cartão em ${home} com ${rule.spend.brand} em ${cat}, sem estornos.`),
        price ? '' : tr(' Without a club price, only the estimated benefit is shown.', ' Sem o preço do clube, só aparece o benefício estimado.'),
      ].join(''),
      relatedIds: rows.map((t) => t.id).slice(0, 30),
      sources: rule.sources.map(src),
    });
  }
  return out;
}

// ---------- reajuste anunciado ----------

function priceChangeCards(subs: SubscriptionRecord[], dataset: Dataset, tr: Tr): InsightCard[] {
  const out: InsightCard[] = [];
  const country = countryOf(dataset.homeCurrency);
  for (const r of subs) {
    const j = r.justRenewed;
    if (!j?.priceChanged || j.previousAmount === undefined || j.previousCurrency !== r.lastCharge.currency) continue;
    const key = subscriptionKey(r.name);
    const change = PRICE_CHANGES.find((c) => c.service === key && c.currency === r.lastCharge.currency && (!country || c.country === country)
      && sameAmount(r.lastCharge.amount, c.to) && sameAmount(j.previousAmount!, c.from) && r.lastCharge.date.slice(0, 10) >= c.announced);
    if (!change) {
      // serviço que a base conhece, aumento sem reajuste público que bata: diz isso, no tom de "confira"
      if (!PRICE_BOOK.some((e) => e.service === key)) continue;
      out.push({
        id: `price-change-${key}`,
        group: 'savings',
        origin: 'local',
        estimate: false,
        title: tr(`${r.name}: the price went up`, `${r.name}: o preço subiu`),
        body: tr(
          `Your ${r.name} charge went from ${money(j.previousAmount, j.previousCurrency)} to ${money(r.lastCharge.amount, r.lastCharge.currency)}. We found no public price change that matches it: worth checking the service’s page or your plan.`,
          `A sua cobrança do ${r.name} passou de ${money(j.previousAmount, j.previousCurrency)} para ${money(r.lastCharge.amount, r.lastCharge.currency)}. Não achamos reajuste público que bata com isso: vale conferir a página do serviço ou o seu plano.`,
        ),
        facts: [
          { label: tr('Before', 'Antes'), value: money(j.previousAmount, j.previousCurrency) },
          { label: tr('Now', 'Agora'), value: money(r.lastCharge.amount, r.lastCharge.currency) },
        ],
        why: tr(
          'The last two charges, in the same currency, compared with the public price changes the price list knows (within 1%). None matches.',
          'As duas últimas cobranças, na mesma moeda, comparadas com os reajustes públicos que a base de preços conhece (até 1%). Nenhum bate.',
        ),
        relatedIds: r.charges.slice(-2).map((t) => t.id),
      });
      continue;
    }
    out.push({
      id: `price-change-${key}`,
      group: 'savings',
      origin: 'local',
      estimate: false,
      title: tr(`${r.name}: the price went up`, `${r.name}: o preço subiu`),
      body: tr(
        `Your ${r.name} charge went from ${money(j.previousAmount, j.previousCurrency)} to ${money(r.lastCharge.amount, r.lastCharge.currency)}. That matches the increase announced on ${endDate(change.announced)}.`,
        `A sua cobrança do ${r.name} passou de ${money(j.previousAmount, j.previousCurrency)} para ${money(r.lastCharge.amount, r.lastCharge.currency)}. Isso bate com o reajuste anunciado em ${endDate(change.announced)}.`,
      ),
      facts: [
        { label: tr('Before', 'Antes'), value: money(j.previousAmount, j.previousCurrency) },
        { label: tr('Now', 'Agora'), value: money(r.lastCharge.amount, r.lastCharge.currency) },
      ],
      why: tr(
        `The last two charges compared with the announced increase (within 1%), from ${change.source.label}, checked on ${change.source.checked}.`,
        `As duas últimas cobranças comparadas com o reajuste anunciado (até 1%), de ${change.source.label}, conferido em ${change.source.checked}.`,
      ),
      relatedIds: r.charges.slice(-2).map((t) => t.id),
      sources: [src(change.source)],
    });
  }
  return out;
}

// ---------- DCC provável ----------

/**
 * Compras em US$ que podem ter sido convertidas na maquininha: perto de uma viagem, ou de um estabelecimento local.
 * Com a casa em US$, cobrar em dólar é o normal: aí só conta a compra feita na mesma cidade de uma compra em moeda
 * estrangeira (a maquininha de lá converteu para a moeda do cartão), e o sinal de estabelecimento local não vale.
 */
export function probableDcc(dataset: Dataset, subscriptionChargeIds: Set<string>): Transaction[] {
  const home = dataset.homeCurrency;
  if (!home) return [];
  const usdHome = home === 'USD';
  const charges = dataset.transactions.filter(isCharge);
  const foreign = charges.filter((t) => t.currency !== home && t.currency !== 'USD');
  const homeMerchants = new Set(charges.filter((t) => t.currency === home && t.merchant).map((t) => t.merchant!));
  return charges.filter((t) => {
    if (t.currency !== 'USD' || subscriptionChargeIds.has(t.id) || DCC.excludeCategories.includes(t.category ?? '')) return false;
    const at = Date.parse(t.date);
    const nearTrip = foreign.some((f) => Math.abs(Date.parse(f.date) - at) <= DCC.tripWindowDays * DAY && (!usdHome || (Boolean(t.city) && f.city === t.city)));
    if (usdHome) return nearTrip;
    const local = DCC.localDescriptors.some((re) => re.test(t.merchantRaw ?? '')) || (DCC.seenInHomeCurrency && Boolean(t.merchant && homeMerchants.has(t.merchant)));
    return nearTrip || local;
  });
}

function dccCards(subs: SubscriptionRecord[], dataset: Dataset, tr: Tr): InsightCard[] {
  const ids = new Set(subs.flatMap((r) => r.charges.map((t) => t.id)));
  const ref = Date.parse(`${dataset.referenceDate}T23:59:59Z`);
  const rows = probableDcc(dataset, ids).filter((t) => ref - Date.parse(t.date) <= 180 * DAY);
  if (!rows.length) return [];
  const total = R2(rows.reduce((s, t) => s + t.amountUsd, 0));
  const [lo, hi] = DCC.measuredMarkup.shops;
  return [{
    id: 'dcc-recent',
    group: 'savings',
    origin: 'local',
    estimate: false,
    title: tr('Purchases that may have been converted at the terminal', 'Compras que podem ter sido convertidas na maquininha'),
    body: tr(
      `${rows.length === 1 ? '1 purchase in the last 6 months was' : `${rows.length} purchases in the last 6 months were`} charged in USD near a trip or by a local merchant (${usd(total)}): they may have been converted at the terminal (DCC). ether.fi suggests paying in the local currency when the terminal offers to convert.`,
      `${rows.length === 1 ? '1 compra dos últimos 6 meses foi cobrada' : `${rows.length} compras dos últimos 6 meses foram cobradas`} em US$ perto de uma viagem ou por um estabelecimento local (${usd(total)}): pode ter sido a conversão na maquininha (DCC). A ether.fi sugere pagar na moeda local quando a maquininha oferece converter.`,
    ),
    facts: [
      { label: tr('Purchases', 'Compras'), value: String(rows.length) },
      { label: tr('Charged in USD', 'Cobrado em US$'), value: usd(total) },
    ],
    why: tr(
      `A purchase in USD within ${DCC.tripWindowDays} days of a purchase in another foreign currency, or from a merchant whose statement name is local or who also charged you in your currency. Online services, travel and subscriptions are left out. It’s probable, not certain, and the dashboard doesn’t estimate what it cost: studies measured conversion markups of ${pct(lo * 100)} to ${pct(hi * 100)} in shops.`,
      `Compra em US$ a até ${DCC.tripWindowDays} dias de uma compra em outra moeda estrangeira, ou de um estabelecimento com nome de fatura local ou que já cobrou você na sua moeda. Serviço online, viagem e assinatura ficam fora. É provável, não certo, e o painel não calcula quanto custou: estudos mediram acréscimos de ${pct(lo * 100)} a ${pct(hi * 100)} em lojas.`,
    ),
    relatedIds: rows.map((t) => t.id).slice(0, 30),
    sources: [...DCC.sources.map(src), src(DCC.measuredMarkup.source)],
  }];
}

/** Os cartões de economia com preço de tabela ou regra com fonte (grupo 'savings'). */
export function savingsCards(dataset: Dataset, opts: InsightOptions, locale: Locale): InsightCard[] {
  const tr: Tr = (en, pt) => pick(locale, en, pt);
  const subs = activeSubscriptions(dataset, opts, locale);
  return [
    ...channelCards(subs, dataset, tr, locale),
    ...annualCards(subs, dataset, tr, locale),
    ...overlapCards(subs, dataset, tr, locale),
    ...priceChangeCards(subs, dataset, tr),
    ...clubCards(subs, dataset, opts, tr, locale),
    ...dccCards(subs, dataset, tr),
  ];
}
