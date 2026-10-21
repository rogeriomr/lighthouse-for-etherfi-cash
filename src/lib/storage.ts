// Tudo o que o painel guarda neste navegador passa por aqui: chaves com namespace e versão (lighthouse:v1:*),
// try/catch em toda leitura e escrita (storage bloqueado, cota cheia, modo privado) e validação opcional da forma.
// Um valor corrompido ou inválido é apagado e vale o padrão: nada de tela branca por causa do storage.

export const NAMESPACE = 'lighthouse:v1:';

/** Chaves em uso. Novas chaves podem ser qualquer texto; ficam todas sob o namespace. */
export const KEYS = {
  decisions: 'subscription-decisions',
  checks: 'renewal-checks',
  dismissed: 'dismissed-anomalies',
  evoMonth: 'evo-month',
  locale: 'locale',
  oauthClient: 'oauth-client',
  oauthTokens: 'oauth-tokens',
  /** sessionStorage: PKCE + state do fluxo em andamento */
  oauthPending: 'oauth-pending',
  /** a pessoa pediu para lembrar os arquivos importados (os dados em si ficam no IndexedDB) */
  importRemember: 'import-remember',
} as const;

/**
 * Recebe o valor já lido do JSON e devolve a versão limpa, ou `undefined` se não servir.
 * Pode filtrar (ex.: descartar só as entradas inválidas de um mapa) em vez de recusar tudo.
 */
export type Validate<T> = (raw: unknown) => T | undefined;

type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  try {
    // o próprio getter lança SecurityError com cookies/site data bloqueados
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

// ---------- migração única das chaves antigas (sem namespace) ----------

/** chave antiga → [área de leitura, chave nova, o valor antigo era texto puro (não JSON), área de escrita (padrão: a de leitura)] */
const LEGACY: [old: string, kind: Area, key: string, plain: boolean, to?: Area][] = [
  ['subscription-decisions', 'local', KEYS.decisions, false],
  ['renewal-checks', 'local', KEYS.checks, false],
  ['dismissed-anomalies', 'local', KEYS.dismissed, false],
  ['evo-month', 'local', KEYS.evoMonth, true],
  ['locale', 'local', KEYS.locale, true],
  ['efd.client', 'local', KEYS.oauthClient, false],
  // a sessão saiu do disco: a chave antiga está no localStorage, o valor novo vai para o sessionStorage
  ['efd.tokens', 'local', KEYS.oauthTokens, false, 'session'],
  ['efd.auth', 'session', KEYS.oauthPending, false],
];

let migrated = false;

/**
 * Move cada chave antiga para o namespace e apaga a antiga. Uma chave antiga só existe se foi gravada por uma versão
 * anterior (ex.: uma aba velha ainda aberta), então ela é a escrita mais recente e vale sobre a nova. Idempotente.
 */
function migrate() {
  if (migrated) return;
  migrated = true;
  for (const [old, kind, key, plain, to] of LEGACY) {
    const s = area(kind);
    if (!s) continue;
    try {
      const value = s.getItem(old);
      if (value === null) continue;
      // as respostas antigas são da pessoa: só um valor ilegível fica para trás
      let json: string | null = plain ? JSON.stringify(value) : value;
      if (!plain) {
        try { JSON.parse(value); } catch { json = null; }
      }
      if (json !== null) {
        const target = area(to ?? kind);
        if (!target) continue;
        target.setItem(NAMESPACE + key, json);
      }
      s.removeItem(old);
    } catch {
      /* cota cheia ou storage bloqueado: tenta de novo no próximo carregamento */
      migrated = false;
    }
  }
}

// ---------- leitura e escrita ----------

function read<T>(kind: Area, key: string, fallback: T, validate?: Validate<T>): T {
  migrate();
  const s = area(kind);
  if (!s) return fallback;
  const full = NAMESPACE + key;
  let text: string | null;
  try {
    text = s.getItem(full);
  } catch {
    return fallback;
  }
  if (text === null) return fallback;
  try {
    const raw: unknown = JSON.parse(text);
    const value = validate ? validate(raw) : (raw as T);
    if (value !== undefined) return value;
  } catch {
    /* JSON quebrado: cai no padrão e apaga abaixo */
  }
  try { s.removeItem(full); } catch { /* noop */ }
  return fallback;
}

function write(kind: Area, key: string, value: unknown): boolean {
  migrate();
  const s = area(kind);
  if (!s) return false;
  try {
    s.setItem(NAMESPACE + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(kind: Area, key: string) {
  migrate();
  try { area(kind)?.removeItem(NAMESPACE + key); } catch { /* noop */ }
}

/** Lê `lighthouse:v1:<key>` do localStorage. Sem valor, ilegível ou recusado por `validate`: devolve `fallback`. */
export const readStore = <T>(key: string, fallback: T, validate?: Validate<T>): T => read('local', key, fallback, validate);
/** Grava em JSON. Devolve `false` se o navegador recusou (bloqueado ou sem cota); nunca lança. */
export const writeStore = (key: string, value: unknown): boolean => write('local', key, value);
export const removeStore = (key: string): void => remove('local', key);

/** O mesmo, no sessionStorage (só esta aba). */
export const readSession = <T>(key: string, fallback: T, validate?: Validate<T>): T => read('session', key, fallback, validate);
export const writeSession = (key: string, value: unknown): boolean => write('session', key, value);
export const removeSession = (key: string): void => remove('session', key);

// ---------- estado compartilhado pela página (useSyncExternalStore) ----------

const synced = new Set<() => void>();

/**
 * Um valor só por chave para a página inteira, pronto para `useSyncExternalStore(s.subscribe, s.snapshot)`:
 * telas diferentes veem a mesma resposta na hora, e o que mudou em outra aba chega pelo evento 'storage'.
 * Se o navegador recusar a gravação, o valor continua valendo na memória até a página fechar.
 */
export function syncedStore<T>(key: string, fallback: T, validate?: Validate<T>) {
  const full = NAMESPACE + key;
  let current: { value: T } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const snapshot = (): T => (current ??= { value: readStore(key, fallback, validate) }).value;
  const save = (next: T) => {
    current = { value: next };
    writeStore(key, next);
    notify();
  };
  const reset = () => {
    current = null;
    notify();
  };
  synced.add(reset);
  const onStorage = (e: StorageEvent) => {
    // e.key null: a outra aba limpou o storage inteiro
    if (e.key !== null && e.key !== full) return;
    reset();
  };
  const subscribe = (listener: () => void) => {
    if (!listeners.size) window.addEventListener('storage', onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) window.removeEventListener('storage', onStorage);
    };
  };
  return { snapshot, save, subscribe };
}

// ---------- dados importados (IndexedDB, só com "lembrar neste navegador") ----------

const IDB_NAME = 'lighthouse-v1';
const IDB_STORE = 'imports';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(IDB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = run(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Guarda um valor no IndexedDB do painel. Devolve `false` se o navegador recusou. */
export async function writeLarge(key: string, value: unknown): Promise<boolean> {
  try {
    await idb('readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

/** Lê do IndexedDB; ausente, recusado pelo `validate` ou com erro: `undefined`. */
export async function readLarge<T>(key: string, validate?: Validate<T>): Promise<T | undefined> {
  try {
    const raw = await idb<unknown>('readonly', (s) => s.get(key));
    if (raw === undefined) return undefined;
    return validate ? validate(raw) : (raw as T);
  } catch {
    return undefined;
  }
}

export async function removeLarge(key: string): Promise<void> {
  try { await idb('readwrite', (s) => s.delete(key)); } catch { /* noop */ }
}

// ---------- esquecer tudo ----------

/**
 * "Esquecer tudo neste navegador": respostas, conferências, alertas vistos, sessão OAuth, cliente registrado e os
 * dados importados. Só o idioma fica (não é dado pessoal, e a tela seguinte continua legível). As telas abertas
 * nesta aba voltam ao padrão na hora; as outras abas, pelo evento 'storage'.
 *
 * O painel não registra service worker nem usa Cache Storage. Mas em localhost:5173 a origem é a mesma de qualquer
 * outro projeto Vite: um service worker deixado por ele controlaria esta página e veria o que ela carrega. Por isso
 * os dois também saem daqui.
 */
export async function forgetEverything(): Promise<void> {
  const legacy = new Set(LEGACY.map(([old]) => old));
  for (const kind of ['local', 'session'] as const) {
    const s = area(kind);
    if (!s) continue;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k === null || k === NAMESPACE + KEYS.locale) continue;
        if (k.startsWith(NAMESPACE) || (legacy.has(k) && k !== 'locale')) doomed.push(k);
      }
      doomed.forEach((k) => s.removeItem(k));
    } catch {
      /* noop */
    }
  }
  synced.forEach((reset) => reset());
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = finish;
      req.onerror = finish;
      // outra aba com o banco aberto: espera ela soltar; não anuncia "apagado" antes disso
      req.onblocked = () => setTimeout(finish, 2000);
      // rede de segurança: uma aba travada não pode deixar o botão preso para sempre
      setTimeout(finish, 5000);
    } catch {
      finish();
    }
  });
  // avisa as outras abas: elas têm os dados em memória e precisam voltar ao demo (storage event)
  write('local', 'forget-at', Date.now());
  try {
    const workers = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(workers.map((w) => w.unregister()));
  } catch {
    /* sem suporte ou bloqueado */
  }
  try {
    if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* noop */
  }
}

/** Há um service worker controlando esta página? O painel não registra nenhum: se houver, veio de outro projeto. */
export function foreignServiceWorker(): boolean {
  try {
    return Boolean(navigator.serviceWorker?.controller);
  } catch {
    return false;
  }
}
