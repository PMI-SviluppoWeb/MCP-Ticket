import { query, generateId, nowUnix } from '../db/pool';
import { EnvConfig, CreaTicketAssistenzaOutput, ValidationError, MCPError, CreaTicketAssistenzaInputSchema } from '../types';

const RE_EMAIL = /[\w.+-]+@[\w.-]+\.\w{2,}/;
const RE_TELEFONO = /(?:\+39|0039)\s*[\d\s\-]{8,15}|(?<!\d)[\d\s\-]{8,15}(?!\d)/;

function estraiEmail(testo: string): string | null {
  const m = testo.match(RE_EMAIL);
  return m ? m[0] : null;
}

function estraiTelefono(testo: string): string | null {
  const m = testo.match(RE_TELEFONO);
  return m ? m[0].trim() : null;
}

// Solo cifre, con '+' iniziale preservato: cosi' il numero resta cercabile
// nell'anagrafica e nella dashboard.
function normalizzaTelefono(valore: string): string {
  const pulito = valore.replace(/[^\d+]/g, "");
  const corpo = pulito.replace(/\+/g, "");
  return pulito.startsWith("+") ? `+${corpo}` : corpo;
}

// Toglie email/numero dal testo libero del contatto: resta il nome del referente.
function pulisciContatto(contatto: string, email: string | null, telefono: string | null): string {
  let nome = contatto;
  if (email) nome = nome.replace(email, " ");
  if (telefono) nome = nome.replace(telefono, " ");
  nome = nome
    .replace(/[<>]/g, "")
    .replace(/[-–—,;|/\\]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return nome || "Non fornito";
}

export async function creaTicketAssistenza(
  input: unknown,
  config: EnvConfig
): Promise<CreaTicketAssistenzaOutput> {
  // Validazione input
  const parseResult = CreaTicketAssistenzaInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi per creazione ticket', parseResult.error.issues);
  }

  const {
    cliente, contatto, modulo_software, sommario_problema, descrizione_dettagliata, priorita,
    email: emailInput, telefono: telefonoInput,
  } = parseResult.data;

  // I contatti arrivano in tre modi possibili: campi dedicati, dentro `contatto`
  // (l'agente vocale spesso mette tutto nel testo libero) o, per l'email,
  // dentro la descrizione. Un recapito dettato male viene scartato e si
  // prova l'estrazione dal testo: la creazione non deve fallire per una mail.
  const emailEsplicita = (emailInput ?? '').trim();
  const telefonoEsplicito = (telefonoInput ?? '').trim();

  let email = emailEsplicita ? estraiEmail(emailEsplicita) : null;
  if (!email) email = estraiEmail(contatto) ?? estraiEmail(descrizione_dettagliata);

  let telefono = telefonoEsplicito ? estraiTelefono(telefonoEsplicito) : null;
  if (!telefono) telefono = estraiTelefono(contatto);
  if (telefono) telefono = normalizzaTelefono(telefono);

  // Il numero puo' non avere 8 cifre utili dopo la normalizzazione: in tal
  // caso viene scartato invece di restituire un relitto inutilizzabile.
  if (telefono && telefono.replace(/\D/g, '').length < 6) telefono = null;

  const contattoPulito = pulisciContatto(contatto, email, telefono);

  try {
    const ticketId = generateId();

    // Genera numero progressivo TICK-XXXX basato sul max esistente
    const maxRes = await query<{ maxn: number | null }>(
      `SELECT MAX(CAST(SUBSTR(numero, 6) AS INTEGER)) as maxn FROM tickets WHERE numero LIKE 'TICK-%'`,
      [],
      config
    );
    const nextNum = (maxRes.rows[0]?.maxn ?? 0) + 1;
    const numero = `TICK-${String(nextNum).padStart(4, '0')}`;

    // Formato data coerente con la dashboard: 'DD/MM/YYYY, HH:MM' (locale)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dataStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const sql = `INSERT INTO tickets (id, numero, cliente, contatto, telefono, email, modulo_software, sommario_problema, descrizione_dettagliata, priorita, stato, data_creazione, data_aggiornamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NUOVO', ?, ?)`;
    const args = [ticketId, numero, cliente, contattoPulito, telefono, email, modulo_software, sommario_problema, descrizione_dettagliata, priorita, dataStr, dataStr];

    try {
      await query(sql, args, config);
    } catch (error) {
      // Alcuni database hanno email NOT NULL: senza indirizzo si riprende lo
      // stesso placeholder della dashboard invece di fallire la creazione.
      const messaggio = String((error as { message?: string })?.message ?? error);
      if (!/NOT NULL/i.test(messaggio)) throw error;
      args[5] = 'sconosciuto@placeholder.it';
      await query(sql, args, config);
    }

    return {
      ticket_id: ticketId,
      messaggio: `Ticket ${numero} creato con successo.`,
      data_creazione: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof MCPError) throw error;
    
    console.error('Errore creazione ticket:', error);
    throw new MCPError(
      'Errore durante la creazione del ticket nel database',
      'TICKET_CREATION_ERROR',
      500
    );
  }
}
