import { z } from 'zod';

// ============================================
// Database Types
// ============================================

// Allineato allo schema reale del DB Turso dell'applicazione ticket-web-app-pmi
export interface Ticket {
  id: string;
  numero: string;
  cliente: string;
  contatto: string;
  telefono: string | null;
  email: string | null;
  modulo_software: string;
  sommario_problema: string;
  descrizione_dettagliata: string;
  priorita: TicketPriority;
  stato: TicketStatus;
  note: string | null;
  operatore: string | null;
  data_creazione: string; // formato app: 'DD/MM/YYYY, HH:MM'
  data_aggiornamento: string;
  data_chiusura: string | null;
}

export type TicketPriority = 'ALTA' | 'MEDIA' | 'BASSA';
export type TicketStatus = 'NUOVO' | 'IN_LAVORAZIONE' | 'CHIUSO';

export interface KnowledgeDoc {
  id: string;
  nome_file: string;
  dimensione: number;
  pagine: number | null;
  testo: string;
  data_creazione: string;
}

// ============================================
// Tool Input/Output Schemas (Zod)
// ============================================

export const RicercaKnowledgeBaseInputSchema = z.object({
  query: z.string().min(1, 'Query non può essere vuota').max(1000, 'Query troppo lunga'),
});

export const CreaTicketAssistenzaInputSchema = z.object({
  cliente: z.string().min(1, 'Nome cliente obbligatorio').max(255),
  contatto: z.string().min(1, 'Contatto obbligatorio').max(255),
  modulo_software: z.string().min(1, 'Modulo software obbligatorio').max(100),
  sommario_problema: z.string().min(1, 'Sommario problema obbligatorio').max(500),
  descrizione_dettagliata: z.string().min(1, 'Descrizione dettagliata obbligatoria').max(5000),
  priorita: z.enum(['ALTA', 'MEDIA', 'BASSA'], {
    errorMap: () => ({ message: 'Priorità deve essere ALTA, MEDIA o BASSA' }),
  }),
});

export const VerificaStatoTicketInputSchema = z.object({
  ticket_id: z.string().min(1, 'ID ticket obbligatorio'),
});

export const IdentificaClienteDaTelefonoInputSchema = z.object({
  telefono: z.string().min(1, 'Numero telefono obbligatorio').max(50),
});

export const RicercaDocumentazioneLiveInputSchema = z.object({
  query: z.string().min(1, 'Query non può essere vuota').max(1000, 'Query troppo lunga'),
});

// ============================================
// Tool Output Types
// ============================================

export interface RicercaKnowledgeBaseOutput {
  risultati: Array<{
    id: string;
    nome_file: string;
    contenuto: string; // snippet estratto dal documento o ticket
    similarita?: number;
    fonte: 'knowledge_base' | 'ticket'; // indica la fonte del risultato
  }>;
  totale_trovati: number;
}

export interface CreaTicketAssistenzaOutput {
  ticket_id: string;
  messaggio: string;
  data_creazione: string;
}

export interface VerificaStatoTicketOutput {
  ticket_id: string;
  numero: string;
  stato: TicketStatus;
  note: string | null;
  operatore: string | null;
  data_creazione: string;
  data_aggiornamento: string;
  data_chiusura: string | null;
  cliente: string;
  modulo_software: string;
  priorita: TicketPriority;
  sommario_problema: string;
}

export interface IdentificaClienteDaTelefonoOutput {
  trovato: boolean;
  cliente?: {
    nome: string;
    telefono: string;
    email: string;
    azienda?: string;
  };
  ticket_recenti?: Array<{
    numero: string;
    stato: string;
    sommario_problema: string;
  }>;
  messaggio?: string;
}

export interface RicercaDocumentazioneLiveOutput {
  trovato: boolean;
  messaggio: string;
  query: string;
  risultati: Array<{
    titolo: string;
    url?: string;
    testo_estratto: string;
  }>;
}

// ============================================
// MCP Tool Definitions
// ============================================

export const MCP_TOOLS = {
  ricerca_knowledge_base: {
    name: 'ricerca_knowledge_base',
    description: 'Cerca nei manuali e documenti tecnici del software (PDF indicizzati) soluzioni a problemi noti; restituisce estratti pertinenti con il nome del documento',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La domanda dell\'utente o parole chiave per la ricerca',
        },
      },
      required: ['query'],
    },
  },
  crea_ticket_assistenza: {
    name: 'crea_ticket_assistenza',
    description: 'Registra un nuovo ticket di supporto nel database del CRM',
    inputSchema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome del cliente' },
        contatto: { type: 'string', description: 'Contatto del cliente (email/telefono)' },
        modulo_software: { type: 'string', description: 'Modulo software interessato' },
        sommario_problema: { type: 'string', description: 'Breve sommario del problema' },
        descrizione_dettagliata: { type: 'string', description: 'Descrizione dettagliata del problema' },
        priorita: { type: 'string', enum: ['ALTA', 'MEDIA', 'BASSA'], description: 'Priorità del ticket' },
      },
      required: ['cliente', 'contatto', 'modulo_software', 'sommario_problema', 'descrizione_dettagliata', 'priorita'],
    },
  },
  verifica_stato_ticket: {
    name: 'verifica_stato_ticket',
    description: 'Verifica lo stato di un ticket esistente per informare il cliente (stati: NUOVO, IN_LAVORAZIONE, CHIUSO)',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'Numero del ticket (es. TICK-0003) oppure ID interno' },
      },
      required: ['ticket_id'],
    },
  },
  identifica_cliente_da_telefono: {
    name: 'identifica_cliente_da_telefono',
    description: 'Identifica un cliente dal suo numero di telefono cercando nella tabella anagrafica clienti del database',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: { type: 'string', description: 'Numero di telefono del cliente (anche con spazi o prefisso +39)' },
      },
      required: ['telefono'],
    },
  },
  ricerca_documentazione_live: {
    name: 'ricerca_documentazione_live',
    description: 'Effettua una ricerca in tempo reale sul portale di supporto di Wolters Kluwer per trovare le guide ufficiali di Arca Evolution su procedure contabili, magazzino o risoluzione di errori.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La procedura o l\'errore specifico da cercare (es. \'creare esercizio contabile\' o \'errore invio fattura elettronica\')',
        },
      },
      required: ['query'],
    },
  },
} as const;

// ============================================
// Error Types
// ============================================

export class MCPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export class AuthenticationError extends MCPError {
  constructor(message = 'Non autorizzato') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class DatabaseError extends MCPError {
  constructor(message: string, public readonly originalError?: Error) {
    super(message, 'DATABASE_ERROR', 500, originalError?.message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, public readonly validationErrors?: z.ZodIssue[]) {
    super(message, 'VALIDATION_ERROR', 400, validationErrors);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends MCPError {
  constructor(resource: string, id: string) {
    super(`${resource} non trovato: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

// ============================================
// Environment Configuration Type
// ============================================

export interface EnvConfig {
  PORT: number;
  NODE_ENV: string;
  MCP_BEARER_TOKEN: string;
  DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDING_MODEL: string;
  VECTOR_SIMILARITY_THRESHOLD: number;
  VECTOR_MAX_RESULTS: number;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Converte timestamp Unix (secondi) in stringa ISO 8601
 */
export function unixToIso(unix: number | string): string {
  const ts = typeof unix === 'string' ? parseInt(unix, 10) : unix;
  return new Date(ts * 1000).toISOString();
}

/**
 * Converte stringa ISO 8601 in timestamp Unix (secondi)
 */
export function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}