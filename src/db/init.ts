import { query, closeClient, generateId, nowUnix } from './pool';
import { EnvConfig } from '../types';
import dotenv from 'dotenv';

dotenv.config();

const config: EnvConfig = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MCP_BEARER_TOKEN: process.env.MCP_BEARER_TOKEN || '',
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.TURSO_AUTH_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  VECTOR_SIMILARITY_THRESHOLD: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD || '0.7'),
  VECTOR_MAX_RESULTS: parseInt(process.env.VECTOR_MAX_RESULTS || '5', 10),
};

// Helper per sostituire placeholder
function replacePlaceholders(sql: string): string {
  return sql
    .replace(/\$\{generateId\(\)\}/g, () => generateId())
    .replace(/\$\{nowUnix\(\)\}/g, () => String(nowUnix()));
}

// ============================================
// Statements separati per evitare problemi con split
// ============================================

const CREATE_TABLES = [
  // Tabella clienti
  `CREATE TABLE IF NOT EXISTS clienti (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    azienda TEXT,
    telefono TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`,
  
  // Tabella tickets
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    cliente TEXT NOT NULL,
    contatto TEXT NOT NULL,
    modulo_software TEXT NOT NULL,
    sommario_problema TEXT NOT NULL,
    descrizione_dettagliata TEXT NOT NULL,
    priorita TEXT NOT NULL CHECK (priorita IN ('ALTA', 'MEDIA', 'BASSA')),
    stato TEXT NOT NULL DEFAULT 'APERTO' CHECK (stato IN ('APERTO', 'IN_LAVORAZIONE', 'CHIUSO', 'ANNULLATO')),
    data_creazione INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    soluzione TEXT
  )`,
  
  // Tabella knowledge_base
  `CREATE TABLE IF NOT EXISTS knowledge_base (
    id TEXT PRIMARY KEY,
    contenuto TEXT NOT NULL,
    embedding TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`,
];

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_clienti_telefono ON clienti(telefono)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_stato ON tickets(stato)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_cliente ON tickets(cliente)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_data_creazione ON tickets(data_creazione DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_modulo ON tickets(modulo_software)`,
];

const CREATE_FTS = [
  // FTS5 Virtual Table
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_base_fts USING fts5(
    contenuto,
    content='knowledge_base',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 1'
  )`,
];

const CREATE_TRIGGERS = [
  // Trigger INSERT
  `CREATE TRIGGER IF NOT EXISTS kb_fts_insert AFTER INSERT ON knowledge_base BEGIN
    INSERT INTO knowledge_base_fts(rowid, contenuto) VALUES (new.rowid, new.contenuto);
  END`,
  
  // Trigger DELETE
  `CREATE TRIGGER IF NOT EXISTS kb_fts_delete AFTER DELETE ON knowledge_base BEGIN
    INSERT INTO knowledge_base_fts(knowledge_base_fts, rowid, contenuto) VALUES ('delete', old.rowid, old.contenuto);
  END`,
  
  // Trigger UPDATE
  `CREATE TRIGGER IF NOT EXISTS kb_fts_update AFTER UPDATE ON knowledge_base BEGIN
    INSERT INTO knowledge_base_fts(knowledge_base_fts, rowid, contenuto) VALUES ('delete', old.rowid, old.contenuto);
    INSERT INTO knowledge_base_fts(rowid, contenuto) VALUES (new.rowid, new.contenuto);
  END`,
];

const INSERT_SAMPLE_DATA = [
  // Clienti
  `INSERT OR IGNORE INTO clienti (id, nome, azienda, telefono, email) VALUES
    ('{{ID1}}', 'Mario Rossi', 'Rossi Srl', '+39 02 1234567', 'mario.rossi@rossi.it'),
    ('{{ID2}}', 'Laura Bianchi', 'Bianchi Spa', '+39 06 7654321', 'laura.bianchi@bianchi.it'),
    ('{{ID3}}', 'Giuseppe Verdi', 'Verdi & Figli', '+39 081 5555555', 'giuseppe.verdi@verdi.it')`,
  
  // Knowledge base
  `INSERT OR IGNORE INTO knowledge_base (id, contenuto, embedding) VALUES
    ('{{ID4}}', 'Errore di connessione al database: verificare che il servizio sia attivo e che le credenziali nel file .env siano corrette. Controllare anche firewall.', NULL),
    ('{{ID5}}', 'Errore 500 nel modulo fatturazione: spesso causato da dati mancanti nei campi obbligatori (partita IVA, codice fiscale). Verificare anagrafica cliente.', NULL),
    ('{{ID6}}', 'Lento caricamento report: ottimizzare le query aggiungendo indici sulle colonne usate in WHERE e JOIN. Considerare materialized views per report complessi.', NULL),
    ('{{ID7}}', 'Problemi invio email: verificare configurazione SMTP (host, porta, credenziali). Controllare che le porte 587/465 non siano bloccate dal firewall.', NULL),
    ('{{ID8}}', 'Errore importazione XML fattura elettronica: validare il file XML contro lo schema XSD ufficiale. Controllare codici natura, tipi documento e codici IVA.', NULL)`,
  
  // Tickets
  `INSERT OR IGNORE INTO tickets (id, cliente, contatto, modulo_software, sommario_problema, descrizione_dettagliata, priorita, stato) VALUES
    ('{{ID9}}', 'Mario Rossi', 'mario.rossi@rossi.it', 'Fatturazione', 'Errore calcolo IVA', 'Il sistema calcola IVA 22% invece di 10% per prodotti editoriali', 'ALTA', 'IN_LAVORAZIONE'),
    ('{{ID10}}', 'Laura Bianchi', 'laura.bianchi@bianchi.it', 'Magazzino', 'Giacenze negative', 'Il report giacenze mostra valori negativi per alcuni articoli', 'MEDIA', 'APERTO'),
    ('{{ID11}}', 'Giuseppe Verdi', 'giuseppe.verdi@verdi.it', 'CRM', 'Export clienti non funziona', 'Cliccando su export CSV non succede nulla, nessun file scaricato', 'BASSA', 'CHIUSO')`,
];

async function executeStatements(statements: string[], description: string) {
  console.log(`\n[DB] ${description}...`);
  for (const stmt of statements) {
    const finalStmt = replacePlaceholders(stmt);
    try {
      await query(finalStmt, [], config);
      console.log(`  ✓ Eseguito`);
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg.includes('already exists') || errMsg.includes('duplicate') || errMsg.includes('UNIQUE constraint failed')) {
        console.log(`  ⊙ Già esistente`);
      } else {
        console.error(`  ✗ Errore:`, errMsg);
        throw error;
      }
    }
  }
}

async function initializeDatabase() {
  console.log('Inizializzazione database Turso/libSQL...');
  
  try {
    // 1. Crea tabelle
    await executeStatements(CREATE_TABLES, 'Creazione tabelle');
    
    // 2. Crea indici
    await executeStatements(CREATE_INDEXES, 'Creazione indici');
    
    // 3. Crea FTS5
    await executeStatements(CREATE_FTS, 'Creazione FTS5');
    
    // 4. Crea trigger
    await executeStatements(CREATE_TRIGGERS, 'Creazione trigger FTS5');
    
    // 5. Inserisci dati di esempio
    await executeStatements(INSERT_SAMPLE_DATA, 'Inserimento dati di esempio');
    
    console.log('\nSchema database creato/aggiornato con successo');
    
    // Verifica tabelle
    const tables = await query<{ name: string }>(`
      SELECT name FROM sqlite_master 
      WHERE type IN ('table', 'view') 
      AND name IN ('clienti', 'tickets', 'knowledge_base', 'knowledge_base_fts')
    `, [], config);
    
    console.log('\nTabelle/viste trovate:', tables.rows.map(r => r.name).join(', '));
    
    // Conta record
    for (const table of ['clienti', 'tickets', 'knowledge_base']) {
      const count = await query<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`, [], config);
      console.log(`${table}: ${count.rows[0].count} record`);
    }
    
    // Test FTS5
    const ftsTest = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM knowledge_base_fts WHERE contenuto MATCH 'database'`, 
      [], 
      config
    );
    console.log(`\nFTS5 test (search 'database'): ${ftsTest.rows[0].count} risultati`);
    
  } catch (error) {
    console.error('Errore durante inizializzazione database:', error);
    throw error;
  } finally {
    await closeClient();
  }
}

// Esegui se chiamato direttamente
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('\nInizializzazione completata');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Inizializzazione fallita:', error);
      process.exit(1);
    });
}

export { initializeDatabase };