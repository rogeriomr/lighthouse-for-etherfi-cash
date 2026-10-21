// npm run check: roda os checks em sequência, um processo por script, e sai com 1 se algum falhar.
// Cada check já pula sozinho a parte que depende de fixtures/live/ (dados reais, fora do git).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECKS = ['pipeline', 'history', 'subscriptions', 'demo', 'anomalies', 'sample', 'portfolio', 'insights', 'security'];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`Node ${process.versions.node}: os checks precisam de --experimental-strip-types (Node >= 22.6; o projeto pede >= 22.13).`);
  process.exit(1);
}

const results = [];
for (const name of CHECKS) {
  const file = fileURLToPath(new URL(`./check-${name}.mts`, import.meta.url));
  console.log(`\n━━━ check-${name} ━━━`);
  const started = Date.now();
  // --disable-warning: o aviso de recurso experimental do strip-types se repetiria em cada script
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', file], {
    stdio: 'inherit',
  });
  const ok = run.status === 0;
  results.push({ name, ok, ms: Date.now() - started, why: run.error?.message ?? (run.signal ? `sinal ${run.signal}` : `código ${run.status}`) });
}

console.log('\n━━━ resumo ━━━');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} check-${r.name} (${(r.ms / 1000).toFixed(1)} s)${r.ok ? '' : ` — ${r.why}`}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} de ${results.length} checks falharam.` : `\nOs ${results.length} checks passaram.`);
process.exit(failed.length ? 1 : 0);
