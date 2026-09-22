import { createClient, Client, ResultSet } from '@libsql/client';
import { EnvConfig, DatabaseError } from '../types';

let client: Client | null = null;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export function getClient(config: EnvConfig): Client {
  if (client) {
    return client;
  }

  const rawUrl = config.DATABASE_URL || '';
  const authToken = config.SUPABASE_SERVICE_ROLE_KEY;

  // Per Turso remoto usa il protocollo HTTPS (evita l'errore 400 sulle migration jobs
  // tipico della modalita' embedded-replica attivata da libsql://)
  const url = rawUrl.startsWith('libsql://') ? rawUrl.replace('libsql://', 'https://') : rawUrl;

  console.log('[DB] URL:', url.replace(/authToken=[^&]+/, 'authToken=***'));
  console.log('[DB] Auth token:', !!authToken);

  // Configurazione client per @libsql/client
  // Supporta sia file: (SQLite locale) che https:// (Turso remoto)
  const clientConfig: any = { url };

  // Per Turso remoto, aggiungi authToken se non nell'URL
  if (url.startsWith('https://') && authToken && !url.includes('authToken=')) {
    clientConfig.authToken = authToken;
  }

  client = createClient(clientConfig);

  console.log('[DB] Client libSQL creato:', url.startsWith('file:') ? 'SQLite locale' : 'Turso/libSQL (https)');
  return client;
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    console.log('[DB] Client chiuso');
  }
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  config?: EnvConfig
): Promise<QueryResult<T>> {
  const db = getClient(config || ({} as EnvConfig));
  const start = Date.now();
  
  try {
    const result: ResultSet = await db.execute({ sql, args: params as any });
    const duration = Date.now() - start;
    
    // Converti rows in oggetti tipizzati
    const rows = result.rows.map(row => {
      const obj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        obj[key] = value;
      }
      return obj as T;
    });
    
    console.debug('[DB] Query eseguita', { 
      sql: sql.substring(0, 100), 
      duration, 
      rows: rows.length 
    });
    
    return { rows, rowCount: rows.length };
  } catch (error) {
    console.error('[DB] Errore query:', { sql: sql.substring(0, 200), error });
    throw new DatabaseError('Errore durante l\'esecuzione della query', error as Error);
  }
}

// Transazione SQLite
export async function transaction<T>(
  callback: (tx: Client) => Promise<T>,
  config: EnvConfig
): Promise<T> {
  const db = getClient(config);
  try {
    await db.execute('BEGIN TRANSACTION');
    const result = await callback(db);
    await db.execute('COMMIT');
    return result;
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }
}

// Tabelle dell'applicazione che i tool MCP si aspettano di trovare
const TABELLE_ATTESE = ['tickets', 'knowledge_docs'];

// Health check: verifica connessione E presenza dello schema dell'app.
// Un semplice SELECT 1 passerebbe anche contro un database sbagliato/vuoto,
// facendo fallire ogni tool a runtime con 'no such table'.
export async function healthCheck(config: EnvConfig): Promise<boolean> {
  try {
    const placeholders = TABELLE_ATTESE.map(() => '?').join(',');
    const result = await query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      TABELLE_ATTESE,
      config
    );
    const trovate = new Set(result.rows.map(r => r.name));
    const mancanti = TABELLE_ATTESE.filter(t => !trovate.has(t));
    if (mancanti.length > 0) {
      console.error(`[DB] Tabelle mancanti nel database: ${mancanti.join(', ')} — DATABASE_URL punta al DB corretto?`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Helper per generare UUID v4 (compatibile SQLite)
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper per timestamp Unix corrente
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// Helper per convertire Unix timestamp in ISO string
export function unixToIso(unix: number | string): string {
  const ts = typeof unix === 'string' ? parseInt(unix, 10) : unix;
  return new Date(ts * 1000).toISOString();
}