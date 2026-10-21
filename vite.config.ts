import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { isDataFile, PROJECT_ROOT, resolveDataDir } from './scripts/data-dir.mjs';

// pasta dos dados reais: o mesmo resolvedor do `npm run pull` e dos checks (scripts/data-dir.mjs): LIGHTHOUSE_DATA_DIR,
// ~/lighthouse-data se existir, ou fixtures/live/ (gitignored)
const DATA = resolveDataDir();
// arquivos sintéticos no formato cru do conector (versionados), para quem não tem conta
const SAMPLE_DIR = join(PROJECT_ROOT, 'fixtures', 'sample');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** o Host sem a porta ("[::1]:5173" → "[::1]") */
const hostName = (host: string | undefined) => (host ?? '').replace(/:\d+$/, '').toLowerCase();

// fora de fixtures/live/ (já negada pelo padrão abaixo), a pasta de dados também fica fora do servidor de arquivos:
// dentro do projeto, só os .json (o pull recusa gravar lá); fora, a pasta inteira
const globPath = (p: string) => p.split(sep).join('/').replace(/[*?[\]{}()!+@]/g, '\\$&');
const DATA_DENY = DATA.ignored ? [] : [DATA.insideProject ? `${globPath(DATA.dir)}/**/*.json` : `${globPath(DATA.dir)}/**`];

// os cabeçalhos do deploy (regra "/(.*)" do vercel.json, os mesmos de public/_headers), para o `vite preview` servir o
// build como o site publicado; um vercel.json ilegível não derruba o servidor de dev
function deployHeaders(): Record<string, string> {
  try {
    const rules = JSON.parse(readFileSync(join(PROJECT_ROOT, 'vercel.json'), 'utf8')).headers as { source: string; headers: { key: string; value: string }[] }[];
    return Object.fromEntries((rules.find((r) => r.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]));
  } catch {
    return {};
  }
}

// dev: serve em /__fixtures os arquivos crus como estão no disco ({ files: [{ name, json, modified }] });
// o navegador os reconhece e junta as páginas pelo mesmo código da importação local (src/lib/rawFiles.ts).
// ?set=sample troca para fixtures/sample/. Só existe no servidor de dev, então esses dados nunca entram no build.
function liveFixtures(): Plugin {
  return {
    name: 'live-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixtures', (req, res) => {
        res.setHeader('cache-control', 'no-store');
        // só leitura, só a própria máquina e só o próprio app: com `npm run dev -- --host` o histórico inteiro ficaria
        // aberto na rede local; um Host de fora (DNS rebinding) ou um pedido vindo de outro site também ficam de fora
        const site = req.headers['sec-fetch-site'];
        if (
          (req.method !== 'GET' && req.method !== 'HEAD')
          || !LOOPBACK.has(req.socket.remoteAddress ?? '')
          || !LOCAL_HOSTS.has(hostName(req.headers.host))
          || (site !== undefined && site !== 'same-origin' && site !== 'none')
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const set = new URL(req.url ?? '/', 'http://localhost').searchParams.get('set');
        // resolvida a cada pedido: mover os dados para ~/lighthouse-data vale sem reiniciar o servidor
        const dir = set === 'sample' ? SAMPLE_DIR : resolveDataDir().dir;
        let names: string[] = [];
        try {
          names = readdirSync(dir).filter(isDataFile).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        } catch {
          /* sem pasta de fixtures */
        }
        const files = names.map((name) => {
          const path = join(dir, name);
          let json: unknown;
          let modified: number | undefined;
          try {
            json = JSON.parse(readFileSync(path, 'utf8'));
            modified = statSync(path).mtimeMs;
          } catch {
            /* JSON inválido: vai sem `json` e o navegador o marca como inválido */
          }
          return { name, json, modified };
        });
        res.statusCode = files.length ? 200 : 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ files }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), liveFixtures()],
  server: {
    // o app é de mesma origem: sem CORS, nenhuma outra página (nem outro servidor em localhost) lê as respostas do dev
    cors: false,
    fs: {
      // os padrões do Vite mais os dados reais: sem isto, /fixtures/live/*.json sairia como arquivo estático (e por
      // ?raw, ?import e /@fs), sem passar pelo filtro do /__fixtures
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/fixtures/live/**', '**/.pull-client.json', '**/*.local.json', ...DATA_DENY],
    },
  },
  preview: { headers: deployHeaders() },
});
