import { EnvConfig, RicercaDocumentazioneLiveOutput, MCPError, ValidationError, RicercaDocumentazioneLiveInputSchema } from '../types';

const JINA_API_URL = 'https://s.jina.ai';
const ARCA_EVOLUTION_SITE = 'site:taasupportportal.wolterskluwer.com/it/it-it/homepage/arca-evolution/arca-evolution/guide-di-prodotto';

export async function ricercaDocumentazioneLive(
  input: unknown,
  config: EnvConfig
): Promise<RicercaDocumentazioneLiveOutput> {
  const parseResult = RicercaDocumentazioneLiveInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi per ricerca documentazione live', parseResult.error.issues);
  }

  const { query: searchQuery } = parseResult.data;
  const jinaApiKey = process.env.JINA_API_KEY;

  const encodedQuery = encodeURIComponent(`${ARCA_EVOLUTION_SITE} ${searchQuery}`);
  const url = `${JINA_API_URL}/${encodedQuery}`;

  const headers: Record<string, string> = {
    'Accept': 'text/plain',
  };

  if (jinaApiKey) {
    headers['Authorization'] = `Bearer ${jinaApiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Nessun dettaglio disponibile');
      console.error(`[Jina] Errore HTTP ${response.status}: ${errorText}`);
      throw new MCPError(
        `Impossibile completare la ricerca live in questo momento (HTTP ${response.status})`,
        'JINA_API_ERROR',
        502
      );
    }

    const testo = await response.text();

    if (!testo || testo.trim().length === 0) {
      return {
        trovato: false,
        messaggio: 'Nessun risultato trovato per la query specificata.',
        query: searchQuery,
        risultati: [],
      };
    }

    const blocchi = testo.split(/\n---\n/).filter(b => b.trim().length > 0);
    const risultati = blocchi.slice(0, 5).map((blocco, idx) => {
      const righe = blocco.trim().split('\n');
      const titolo = righe.find(r => r.startsWith('#'))?.replace(/^#+\s*/, '') || `Risultato ${idx + 1}`;
      const urlMatch = blocco.match(/https?:\/\/[^\s)]+/);
      return {
        titolo: titolo.trim(),
        url: urlMatch ? urlMatch[0] : undefined,
        testo_estratto: blocco.trim().substring(0, 2000),
      };
    });

    return {
      trovato: risultati.length > 0,
      messaggio: risultati.length > 0
        ? `Trovati ${risultati.length} risultati dalla documentazione ufficiale Wolters Kluwer.`
        : 'Nessun risultato pertinente trovato nella documentazione ufficiale.',
      query: searchQuery,
      risultati,
    };
  } catch (error) {
    if (error instanceof MCPError) throw error;

    console.error('Errore ricerca documentazione live:', error);
    throw new MCPError(
      'Impossibile completare la ricerca live in questo momento',
      'JINA_SEARCH_ERROR',
      500
    );
  }
}
