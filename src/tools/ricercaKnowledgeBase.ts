import { query } from '../db/pool';
import { EnvConfig, RicercaKnowledgeBaseOutput, MCPError, ValidationError, RicercaKnowledgeBaseInputSchema } from '../types';

// Tipo interno per unire risultati da fonti diverse
interface RisultatoRicerca {
  id: string;
  nome_file: string;
  contenuto: string;
  similarita: number;
  fonte: 'knowledge_base' | 'ticket';
}

const MAX_TOKENS = 6;
const SNIPPET_CONTEXT = 300; // caratteri di contesto prima/dopo l'occorrenza

// Parole comuni italiane: non discriminano e sporcherebbero ranking e snippet
const STOPWORDS = new Set([
  'come', 'cosa', 'quando', 'dove', 'perche', 'essere', 'sono', 'fare', 'fatto',
  'molto', 'troppo', 'anche', 'questo', 'questa', 'quello', 'quella', 'questi',
  'non', 'del', 'della', 'delle', 'nel', 'nella', 'nello', 'sul', 'sulla',
  'con', 'per', 'tra', 'fra', 'una', 'uno', 'gli', 'dei', 'che', 'chi',
  'gli', 'lei', 'lui', 'loro', 'mio', 'tuo', 'suo', 'mia', 'tua', 'sua',
  'funziona', 'problema', 'errore', 'aiuto', 'vorrei', 'posso', 'devo',
]);

/**
 * Escape dei caratteri speciali LIKE (% e _) per confronti letterali.
 * Va usato insieme a ESCAPE '\' nella query.
 */
function escapeLike(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Tokenizza la query in parole significative (>= 3 caratteri, no stopword), deduplicate.
 * Se il filtro stopword svuota tutto, ricade sulle parole grezze.
 */
function tokenizza(searchQuery: string): string[] {
  const parole = [...new Set(
    searchQuery
      .toLowerCase()
      .split(/[^a-z0-9àèéìòù]+/i)
      .filter(p => p.length >= 3)
  )];
  const significative = parole.filter(p => !STOPWORDS.has(p));
  return (significative.length > 0 ? significative : parole).slice(0, MAX_TOKENS);
}

/**
 * Conta quante volte un token occorre nel testo (case-insensitive).
 */
function contaOccorrenze(testoLower: string, token: string): number {
  let count = 0;
  let idx = testoLower.indexOf(token);
  while (idx !== -1) {
    count++;
    idx = testoLower.indexOf(token, idx + token.length);
  }
  return count;
}

/**
 * Estrae lo snippet piu' pertinente: la finestra di testo con la massima
 * densita' di token distinti della query (a parita', piu' occorrenze totali).
 */
function estraiSnippet(testo: string, tokens: string[]): string {
  const testoLower = testo.toLowerCase();

  // Posizioni delle occorrenze (limitate per token, per non esplodere su testi grandi)
  const posizioni: number[] = [];
  for (const token of tokens) {
    let idx = testoLower.indexOf(token);
    let n = 0;
    while (idx !== -1 && n < 50) {
      posizioni.push(idx);
      n++;
      idx = testoLower.indexOf(token, idx + token.length);
    }
  }

  if (posizioni.length === 0) {
    // Non dovrebbe accadere (la WHERE garantisce un match), fallback prudente
    return testo.substring(0, SNIPPET_CONTEXT * 2).replace(/\s+/g, ' ').trim();
  }

  // Valuta la finestra centrata su ogni occorrenza, tieni la migliore
  let bestStart = Math.max(0, posizioni[0] - SNIPPET_CONTEXT);
  let bestScore = -1;
  for (const pos of posizioni) {
    const start = Math.max(0, pos - SNIPPET_CONTEXT);
    const end = Math.min(testo.length, pos + SNIPPET_CONTEXT);
    const finestra = testoLower.substring(start, end);
    let distinti = 0;
    let totale = 0;
    for (const token of tokens) {
      const c = contaOccorrenze(finestra, token);
      if (c > 0) {
        distinti++;
        totale += c;
      }
    }
    const score = distinti * 1000 + totale;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const bestEnd = Math.min(testo.length, bestStart + SNIPPET_CONTEXT * 2);
  const prefix = bestStart > 0 ? '…' : '';
  const suffix = bestEnd < testo.length ? '…' : '';

  return (prefix + testo.substring(bestStart, bestEnd) + suffix).replace(/\s+/g, ' ').trim();
}

export async function ricercaKnowledgeBase(
  input: unknown,
  config: EnvConfig
): Promise<RicercaKnowledgeBaseOutput> {
  // Validazione input
  const parseResult = RicercaKnowledgeBaseInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi', parseResult.error.issues);
  }

  const { query: searchQuery } = parseResult.data;

  try {
    let tokens = tokenizza(searchQuery);

    // Fallback: query senza parole >= 3 caratteri -> cerca la frase intera
    if (tokens.length === 0) {
      tokens = [searchQuery.toLowerCase().trim()];
    }

    // Ricerca LIKE sui documenti (knowledge_docs contiene il testo integrale dei manuali PDF)
    const whereClause = tokens
      .map(() => `testo LIKE '%' || ? || '%' ESCAPE '\\'`)
      .join(' OR ');
    const params = tokens.map(escapeLike);

    const docs = await query<{
      id: string;
      nome_file: string;
      testo: string;
    }>(
      `SELECT id, nome_file, testo FROM knowledge_docs WHERE ${whereClause}`,
      params,
      config
    );

    // Ranking in JS: privilegia i documenti che matchano piu' token distinti
    const scoredDocs = docs.rows
      .map(doc => {
        const testoLower = doc.testo.toLowerCase();
        let tokenMatchati = 0;
        let occorrenze = 0;
        for (const token of tokens) {
          const n = contaOccorrenze(testoLower, token);
          if (n > 0) {
            tokenMatchati++;
            occorrenze += n;
          }
        }
        return { 
          id: doc.id,
          nome_file: doc.nome_file,
          contenuto: doc.testo,
          tokenMatchati, 
          occorrenze,
          fonte: 'knowledge_base' as const,
        };
      })
      .filter(r => r.tokenMatchati > 0);

    // Ricerca nei ticket chiusi: campo note (contiene le note dei tecnici)
    const ticketWhereClause = tokens
      .map(() => `note LIKE '%' || ? || '%' ESCAPE '\\'`)
      .join(' OR ');
    const ticketParams = tokens.map(escapeLike);

    const tickets = await query<{
      id: string;
      numero: string;
      sommario_problema: string;
      note: string | null;
      modulo_software: string;
    }>(
      `SELECT id, numero, sommario_problema, note, modulo_software 
       FROM tickets 
       WHERE stato = 'CHIUSO' AND (${ticketWhereClause})`,
      ticketParams,
      config
    );

    // Ranking ticket: usa il campo note per il confronto
    const scoredTickets = tickets.rows
      .map(ticket => {
        const testoCompleto = ticket.note || '';
        const testoLower = testoCompleto.toLowerCase();
        let tokenMatchati = 0;
        let occorrenze = 0;
        for (const token of tokens) {
          const n = contaOccorrenze(testoLower, token);
          if (n > 0) {
            tokenMatchati++;
            occorrenze += n;
          }
        }
        // Costruisce snippet da note con contesto del ticket
        const snippetTesto = `Ticket ${ticket.numero} (${ticket.modulo_software}): ${ticket.sommario_problema}\n${testoCompleto}`;
        return { 
          id: ticket.id,
          nome_file: `Ticket ${ticket.numero} - Soluzione`,
          contenuto: snippetTesto,
          tokenMatchati, 
          occorrenze,
          fonte: 'ticket' as const,
        };
      })
      .filter(r => r.tokenMatchati > 0);

    // Unisce e ranka tutti i risultati insieme
    const tuttiRisultati = [...scoredDocs, ...scoredTickets]
      .sort((a, b) => b.tokenMatchati - a.tokenMatchati || b.occorrenze - a.occorrenze)
      .slice(0, config.VECTOR_MAX_RESULTS);

    const risultati = tuttiRisultati.map(({ id, nome_file, contenuto, tokenMatchati, fonte }) => ({
      id,
      nome_file,
      contenuto: fonte === 'ticket' ? contenuto : estraiSnippet(contenuto, tokens),
      similarita: tokenMatchati / tokens.length,
      fonte,
    }));

    return {
      risultati,
      totale_trovati: risultati.length,
    };
  } catch (error) {
    console.error('Errore ricerca knowledge base:', error);
    throw new MCPError(
      'Errore durante la ricerca nella knowledge base',
      'KNOWLEDGE_BASE_SEARCH_ERROR',
      500
    );
  }
}
