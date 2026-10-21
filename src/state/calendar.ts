// Lembretes de renovação em .ics: o arquivo sai das respostas da pessoa e é gerado e baixado aqui no navegador.
import { buildIcs } from '../lib/subscriptions';
import type { SubscriptionReport } from '../lib/subscriptionTypes';
import { pick, type Locale } from '../lib/locale';
import { plansToCancel, type Decisions } from './decisions';

/** O calendário sai das ativas com renovação; quem já cancelou não precisa de lembrete. */
export function icsFor(report: SubscriptionReport, decisions: Decisions, locale: Locale): { text: string; events: number } {
  const records = report.records.filter((r) => !(plansToCancel(r) && decisions[r.key]?.done));
  const text = buildIcs(records, { calendarName: pick(locale, 'Subscription renewals', 'Renovações de assinaturas'), locale });
  return { text, events: (text.match(/^BEGIN:VEVENT/gm) ?? []).length };
}

/** Gera o arquivo aqui mesmo e entrega como download: nada sai do computador. */
export function downloadFile(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
