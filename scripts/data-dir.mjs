// Onde ficam os dados reais: as respostas cruas do conector, o ptax.json, os arquivos da IA e o .pull-client.json.
// Um resolvedor só para o vite.config, o npm run pull, os checks e o privacy-scan. A ordem:
//   1. LIGHTHOUSE_DATA_DIR (absoluto, ou relativo à raiz do projeto);
//   2. lighthouse-data na pasta pessoal (%USERPROFILE%\lighthouse-data no Windows, ~/lighthouse-data no macOS e no
//      Linux), se existir: fica fora do projeto e de pastas sincronizadas, com as permissões só da sua conta;
//   3. fixtures/live/ (no .gitignore).
// Para conferir qual vale nesta máquina: node scripts/data-dir.mjs
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const HOME_DATA_DIR_NAME = 'lighthouse-data';
export const CLIENT_FILE_NAME = '.pull-client.json';
/** onde o pull guardava o client_id até a 0.1 (ainda lido, para não registrar um cliente novo) */
export const LEGACY_CLIENT_FILE = join(PROJECT_ROOT, 'fixtures', CLIENT_FILE_NAME);

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `child` é `parent` ou fica dentro dele (no Windows, sem diferença de maiúsculas, como o path.relative) */
export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Caminho para mostrar na tela ou no terminal: a pasta pessoal vira %USERPROFILE% ou ~, sem o nome do usuário. */
export function displayPath(p, home = homedir()) {
  if (!home || !isInside(p, home)) return p;
  const rest = relative(home, p);
  const base = process.platform === 'win32' ? '%USERPROFILE%' : '~';
  return rest ? `${base}${sep}${rest}` : base;
}

/** As três candidatas, na ordem; `null` quando não se aplicam. */
function candidates({ env = process.env, home = homedir(), root = PROJECT_ROOT } = {}) {
  const fromEnv = env.LIGHTHOUSE_DATA_DIR?.trim();
  return {
    env: fromEnv ? resolve(root, fromEnv) : null,
    home: home ? join(home, HOME_DATA_DIR_NAME) : null,
    project: join(root, 'fixtures', 'live'),
  };
}

/**
 * A pasta de dados e de onde ela veio. `insideProject`: dentro da raiz do projeto; `ignored`: dentro de fixtures/live/,
 * que o git ignora. Uma pasta do projeto fora de fixtures/live/ iria para o git: o pull recusa gravar nela.
 */
export function resolveDataDir(opts = {}) {
  const root = opts.root ?? PROJECT_ROOT;
  const home = opts.home === undefined ? homedir() : opts.home;
  const c = candidates({ ...opts, root, home });
  const [dir, source] = c.env ? [c.env, 'env'] : c.home && isDir(c.home) ? [c.home, 'home'] : [c.project, 'project'];
  return {
    dir,
    source,
    /** com barra no fim, para new URL(nome, url) */
    url: pathToFileURL(dir.endsWith(sep) ? dir : dir + sep),
    insideProject: isInside(dir, root),
    ignored: isInside(dir, c.project),
    label: source === 'project' ? 'fixtures/live/' : displayPath(dir, home),
    clientFile: join(dir, CLIENT_FILE_NAME),
  };
}

/** Todas as candidatas que existem, na mesma ordem e sem repetir: o privacy-scan compara com todas (sobra de pasta antiga conta). */
export function existingDataDirs(opts = {}) {
  const c = candidates({ ...opts, root: opts.root ?? PROJECT_ROOT, home: opts.home === undefined ? homedir() : opts.home });
  const seen = [];
  for (const d of [c.env, c.home, c.project]) {
    if (d && isDir(d) && !seen.some((s) => isInside(s, d) && isInside(d, s))) seen.push(d);
  }
  return seen;
}

/**
 * Os arquivos que o app lê da pasta: .json visíveis. Ficam de fora os ocultos (o .pull-client.json) e os *.local.json,
 * que são só desta máquina (por exemplo, a lista de identidade do privacy-scan).
 */
export const isDataFile = (name) => name.endsWith('.json') && !name.startsWith('.') && !name.endsWith('.local.json');

// node scripts/data-dir.mjs: diz qual pasta vale e por quê
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const d = resolveDataDir();
  const why = { env: 'LIGHTHOUSE_DATA_DIR', home: `${HOME_DATA_DIR_NAME} na pasta pessoal`, project: 'padrão do projeto' }[d.source];
  console.log(`${d.label} (${why}${d.insideProject && !d.ignored ? '; ATENÇÃO: dentro do projeto e fora do .gitignore' : ''})`);
}
