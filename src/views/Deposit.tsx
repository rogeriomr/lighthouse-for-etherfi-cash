import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PRIVACY_NOTE } from '../lib/config';
import { networkLabel } from '../lib/labels';
import { localized } from '../lib/locale';
import { keepHyphens } from '../lib/textLang';
import { cx } from '../lib/cx';
import type { DepositInfo } from '../lib/types';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, Panel, PanelTitle } from '../components/ui';
import { Copy, Check, Info, ShieldAlert, TriangleAlert, Wallet } from 'lucide-react';

// o gerador de QR só é baixado quando esta aba abre (era 16 kB em toda visita)
const QRCodeSVG = lazy(() => import('qrcode.react').then((m) => ({ default: m.QRCodeSVG })));

const QR_SIZE = 148;
/** Ativos à vista no celular antes do "mostrar todos" (duas linhas) */
const ASSETS_FOLDED = 8;

/**
 * Cada ativo só é aceito em algumas redes. A tela parte do ativo e mostra as redes dele,
 * porque mandar pela rede errada é perda definitiva.
 */
export function DepositSection() {
  const { dataset, isSample } = useStore();
  const { deposit } = dataset;
  const { locale } = useLocale();
  const tr = useTr();
  const options = deposit.assetNetworks ?? [];
  const [picked, setSymbol] = useState('USDC');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const assetRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // se o dataset trocar e o ativo escolhido não existir nele, volta para o primeiro disponível
  const selected = options.find((a) => a.symbol === picked) ?? options[0];
  const symbol = selected?.symbol ?? '';
  const address = deposit.address.trim();
  // no demo o endereço é de exemplo: nada de QR legível nem de copiar algo que alguém possa usar para enviar dinheiro.
  // Com dados de verdade, só o endereço que confere com a conta (normalize.ts) é utilizável; o QR só sai com `trusted`
  // (conexão ao vivo), porque um arquivo importado pode trazer outro endereço com os campos coerentes entre si.
  const usable = Boolean(address) && !isSample && deposit.check === 'match';
  // arquivo importado não é fonte confiável: 'match' só diz que os próprios arquivos concordam entre si.
  // Copiar/QR só com conexão ao vivo; um lote forjado pode trazer o endereço do atacante coerente com o resto.
  const verified = usable && deposit.trusted === true;
  const unconfirmed = Boolean(address) && !isSample && !usable;

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  const copy = async () => {
    if (!verified) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // celular: com muitos ativos, os primeiros 8 (e o escolhido) e um "mostrar todos"; no desktop cabem todos
  const [allAssets, setAllAssets] = useState(false);
  const folded = (i: number) => !allAssets && i >= ASSETS_FOLDED && options[i].symbol !== symbol;

  // radiogroup de verdade: uma parada de Tab e setas para trocar de ativo (só entre os que estão à vista)
  const moveAsset = (from: number, dir: number) => {
    for (let step = 1; step <= options.length; step++) {
      const next = (from + dir * step + options.length * step) % options.length;
      const el = assetRefs.current[next];
      if (!el || el.offsetParent === null) continue;
      setSymbol(options[next].symbol);
      el.focus();
      return;
    }
  };

  return (
    <div className="space-y-5">
      {dataset.neverFunded ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-4 text-sm text-muted">
          <Wallet aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <p>
            <span className="font-medium text-ink">{tr('This account hasn’t been funded yet.', 'Esta conta ainda não foi financiada.')}</span>{' '}
            {tr(
              'That’s normal for a new account. The first deposit goes here: pick the asset, check its networks and send to the address below.',
              'É o normal de uma conta nova. O primeiro depósito começa aqui: escolha o ativo, confira as redes dele e envie para o endereço abaixo.',
            )}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelTitle>{tr('1 · Choose what you’ll send', '1 · Escolha o que vai enviar')}</PanelTitle>
          {/* as redes vêm do mesmo arquivo do endereço: se ele não veio da conexão ao vivo, elas também não valem como fonte */}
          {!isSample && Boolean(address) && !verified && (options.length || deposit.networks.length) ? (
            <p className="mb-4 flex items-start gap-2 text-xs leading-relaxed text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {tr(
                'These networks come from the same file as the address, which isn’t confirmed: check them in Deposit, in the ether.fi app.',
                'Estas redes vêm do mesmo arquivo do endereço, que não foi confirmado: confira as redes em Depositar, no app da ether.fi.',
              )}
            </p>
          ) : null}
          {options.length ? (
            <>
              <div role="radiogroup" aria-label={tr('Asset', 'Ativo')} className="flex flex-wrap gap-2">
                {options.map((a, i) => {
                  const active = a.symbol === symbol;
                  return (
                    <button
                      key={a.symbol}
                      ref={(el) => { assetRefs.current[i] = el; }}
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setSymbol(a.symbol)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveAsset(i, 1); }
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveAsset(i, -1); }
                      }}
                      className={cx(
                        'min-h-11 min-w-14 cursor-pointer rounded-md border px-3 text-sm transition-colors active:bg-panel2 pointer-fine:sm:min-h-8 pointer-fine:sm:min-w-0 pointer-fine:sm:px-2.5 pointer-fine:sm:text-xs',
                        active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line2 text-muted hover:text-ink',
                        folded(i) && 'max-sm:hidden pointer-coarse:hidden',
                      )}
                    >
                      {a.symbol}
                    </button>
                  );
                })}
              </div>
              {options.length > ASSETS_FOLDED + 1 ? (
                <button
                  type="button"
                  aria-expanded={allAssets}
                  onClick={() => {
                    // abrindo: o foco vai para o primeiro ativo que apareceu (o botão desce para fora da tela)
                    const opening = !allAssets;
                    setAllAssets(opening);
                    if (opening) requestAnimationFrame(() => assetRefs.current[ASSETS_FOLDED]?.focus());
                  }}
                  className="mt-2 inline-flex min-h-11 cursor-pointer items-center text-sm text-muted underline decoration-dotted underline-offset-2 hover:text-ink active:text-ink pointer-fine:sm:hidden"
                >
                  {allAssets ? tr('Show fewer', 'Mostrar menos') : tr(`Show all (${options.length})`, `Mostrar todos (${options.length})`)}
                </button>
              ) : null}
              {selected ? (
                <div className="mt-5 rounded-xl border border-line bg-panel2/40 p-4">
                  <div className="text-sm">
                    <span className="font-medium">{selected.name}</span> {tr('is only accepted on these networks:', 'é aceito só nestas redes:')}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {selected.networks.map((n) => <Badge key={n}>{networkLabel(n)}</Badge>)}
                  </div>
                  <div className="mt-3 flex items-start gap-2 text-xs text-warn">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {tr(
                      `${selected.symbol} sent over any other network is lost and can’t be recovered.`,
                      `${selected.symbol} enviado por qualquer outra rede se perde e não tem como recuperar.`,
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : !deposit.assets.length && !deposit.networks.length ? (
            // nada veio (conta nova, sem endereço ainda): não há combinação para alertar, só o caminho
            <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line px-4 py-4 text-sm text-muted">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
              <p>
                {tr(
                  'The connector didn’t list assets or networks for this account. The ether.fi app shows them in Deposit.',
                  'O conector não listou ativos nem redes para esta conta. O app da ether.fi mostra isso em Depositar.',
                )}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm text-muted">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
              <div>
                {tr(
                  'The source didn’t say which networks accept each asset, and not every asset is accepted on every network. Check the combination in the ether.fi app before sending.',
                  'A fonte não informou quais redes aceitam cada ativo, e nem todo ativo é aceito em toda rede. Confira a combinação no app da ether.fi antes de enviar.',
                )}
                {deposit.assets.length ? (
                  <div className="mt-2 text-xs text-faint">
                    {tr('Assets', 'Ativos')}: {deposit.assets.join(', ')} · {tr('Networks', 'Redes')}: {deposit.networks.map(networkLabel).join(', ')}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelTitle hint={isSample ? tr('sample address', 'endereço fictício') : Boolean(address) && !verified ? tr('not confirmed', 'não confirmado') : undefined}>{tr('2 · Send to this address', '2 · Envie para este endereço')}</PanelTitle>
          {unconfirmed ? (
            <Unconfirmed check={deposit.check} />
          ) : address ? (
            <div className="flex flex-col items-start gap-4">
              {isSample ? (
                <div className="flex w-full items-start gap-2.5 rounded-xl border border-line2 bg-panel2/60 p-3 text-xs leading-relaxed text-muted">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
                  <span>
                    {tr(
                      'Example only: this address doesn’t exist, so the QR code is blurred and copying is off. With your own data, your vault address shows up here.',
                      'Só um exemplo: este endereço não existe, por isso o QR code está desfocado e a cópia, desligada. Com os seus dados, aqui aparece o endereço do seu vault.',
                    )}
                  </span>
                </div>
              ) : null}
              {isSample || verified ? (
                <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-3">
                  <Suspense fallback={<div style={{ width: QR_SIZE, height: QR_SIZE }} />}>
                    {isSample ? (
                      // desfocado e sem nome: decorativo no demo, o aviso acima explica
                      <div aria-hidden className="pointer-events-none blur-[5px] select-none">
                        <QRCodeSVG value={address} size={QR_SIZE} fgColor="#0a0a0a" bgColor="#ffffff" />
                      </div>
                    ) : (
                      <QRCodeSVG
                        value={address}
                        size={QR_SIZE}
                        fgColor="#0a0a0a"
                        bgColor="#ffffff"
                        title={tr('QR code of the deposit address', 'QR code do endereço de depósito')}
                      />
                    )}
                  </Suspense>
                </div>
              ) : (
                <div className="flex w-full items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs leading-relaxed text-muted">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                  <span>
                    {tr(
                      'The QR code is off for an address that came from imported files. Confirm it in the ether.fi app before sending.',
                      'O QR code fica desligado para um endereço vindo de arquivos importados. Confirme no app da ether.fi antes de enviar.',
                    )}
                  </span>
                </div>
              )}
              {/*
                em grupos de 4 para conferir de olho com o app ("0x1a2b 3c4d …"); entre os grupos há só margem e um ponto
                de quebra, nenhum caractere: selecionar e copiar à mão também sai sem espaços
              */}
              <div className={cx('w-full rounded-lg border border-line bg-panel2 px-4 py-3 font-mono text-sm leading-relaxed', isSample ? 'break-all text-muted' : 'text-ink')}>
                {isSample || !/^0x[0-9a-fA-F]+$/.test(address)
                  ? address
                  : [address.slice(0, 6), ...(address.slice(6).match(/.{1,4}/g) ?? [])].map((g, i) => (
                      <Fragment key={i}>
                        {i ? <wbr /> : null}
                        <span className="mr-[0.45em] inline-block">{g}</span>
                      </Fragment>
                    ))}
              </div>
              {!isSample && !verified ? (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-warn">
                  <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {tr(
                    'This address matched the other fields in the files you imported, not a live connection. Copying and the QR code are off for imported files; compare it with Deposit in the ether.fi app.',
                    'Este endereço confere com os outros campos dos arquivos que você importou, não com uma conexão ao vivo. A cópia e o QR ficam desligados para arquivos importados; compare com Depositar no app da ether.fi.',
                  )}
                </p>
              ) : null}
              <button
                onClick={copy}
                disabled={!verified}
                title={isSample ? tr('Copying is off in the demo', 'A cópia fica desligada no demo') : !verified ? tr('Copying is off for imported files; verify the address in the ether.fi app', 'A cópia fica desligada para arquivos importados; confira o endereço no app da ether.fi') : undefined}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line2 px-3.5 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-muted active:bg-panel2 pointer-fine:sm:min-h-9 pointer-fine:sm:text-xs"
              >
                {copied ? <Check aria-hidden className="size-3.5 text-good" /> : <Copy aria-hidden className="size-3.5" />}
                {copied
                  ? tr('Copied', 'Copiado')
                  : isSample
                    ? tr('Copy address (off in the demo)', 'Copiar endereço (desligado no demo)')
                    : !verified
                      ? tr('Copy address (off for imported files)', 'Copiar endereço (desligado para arquivos importados)')
                      : tr('Copy address', 'Copiar endereço')}
              </button>
              <span role="status" className="sr-only">{copied ? tr('Address copied', 'Endereço copiado') : ''}</span>
              {/* sempre, mesmo com o endereço conferido aqui: a fonte de verdade é o app da ether.fi */}
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-info" />
                {tr(
                  'Before sending, check that Deposit in the ether.fi app shows this same address.',
                  'Antes de enviar, confira se Depositar, no app da ether.fi, mostra este mesmo endereço.',
                )}
              </p>
              <p className="text-xs text-faint">
                {tr(
                  'The same address works on every accepted network. What changes per asset is which networks you can use.',
                  'O mesmo endereço vale em todas as redes aceitas. O que muda por ativo é quais redes servem.',
                )}
              </p>
              <div className="flex items-start gap-2.5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                {keepHyphens(localized(PRIVACY_NOTE, locale) ?? '')}
              </div>
            </div>
          ) : (
            // sem endereço não há QR nem botão de copiar: só o caminho certo
            <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
              <p>
                {dataset.neverFunded
                  ? tr(
                      'The connector didn’t return a deposit address for this account yet. Open Deposit in the ether.fi app to get it.',
                      'O conector ainda não devolveu um endereço de depósito para esta conta. Abra Depositar no app da ether.fi para obtê-lo.',
                    )
                  : tr(
                      'The connector didn’t return a deposit address. Use Deposit in the ether.fi app, and never send to an address you can’t confirm there.',
                      'O conector não devolveu um endereço de depósito. Use Depositar no app da ether.fi e nunca envie para um endereço que você não consiga confirmar lá.',
                    )}
              </p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Endereço que não confere com a conta (DepositInfo.check): sem QR, sem cópia e sem o endereço à vista, porque um
 * arquivo trocado mostraria o endereço de outra pessoa ao lado do extrato verdadeiro. Fica o motivo e o caminho certo.
 */
function Unconfirmed({ check }: { check: DepositInfo['check'] }) {
  const tr = useTr();
  const why =
    check === 'mismatch'
      ? tr('The deposit address in the loaded files isn’t the address of the account (get_main_account).', 'O endereço de depósito dos arquivos carregados não é o endereço da conta (get_main_account).')
      : check === 'mixed_accounts'
        ? tr('The loaded files aren’t all from the same account.', 'Os arquivos carregados não são todos da mesma conta.')
        : check === 'separate_import'
          ? tr(
            'The deposit address came in a separate import from the rest of the account. To confirm it, import all the files from the same npm run pull together.',
            'O endereço de depósito veio numa importação separada do resto da conta. Para confirmá-lo, importe juntos todos os arquivos do mesmo npm run pull.',
          )
        : check === 'invalid'
          ? tr('It isn’t in the format of an address (0x and 40 characters).', 'Ele não tem o formato de um endereço (0x e 40 caracteres).')
          : tr('There’s no account address (get_main_account) to compare it with.', 'Não há o endereço da conta (get_main_account) para comparar.');
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm leading-relaxed text-muted">
      <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="space-y-1.5">
        <p className="font-medium text-ink">{tr('Deposit address not confirmed', 'Endereço de depósito não confirmado')}</p>
        <p>{why} {tr('So the QR code and copying are off.', 'Por isso, o QR code e a cópia ficam desligados.')}</p>
        <p>{tr('Get the address in Deposit, in the ether.fi app, and send only to the address shown there.', 'Pegue o endereço em Depositar, no app da ether.fi, e envie só para o endereço mostrado lá.')}</p>
      </div>
    </div>
  );
}
