// Tipos do data-dir.mjs, para os checks em TypeScript importarem o resolvedor da pasta de dados.
export interface DataDirOptions {
  env?: Record<string, string | undefined>;
  /** pasta pessoal; null desliga a candidata lighthouse-data */
  home?: string | null;
  root?: string;
}

export interface DataDir {
  dir: string;
  source: 'env' | 'home' | 'project';
  url: URL;
  insideProject: boolean;
  ignored: boolean;
  label: string;
  clientFile: string;
}

export const PROJECT_ROOT: string;
export const HOME_DATA_DIR_NAME: string;
export const CLIENT_FILE_NAME: string;
export const LEGACY_CLIENT_FILE: string;

export function isInside(child: string, parent: string): boolean;
export function displayPath(p: string, home?: string | null): string;
export function resolveDataDir(opts?: DataDirOptions): DataDir;
export function existingDataDirs(opts?: DataDirOptions): string[];
export function isDataFile(name: string): boolean;
