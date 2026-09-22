import { query, generateId, nowUnix } from '../db/pool';
import { EnvConfig, CreaTicketAssistenzaOutput, ValidationError, MCPError, CreaTicketAssistenzaInputSchema } from '../types';

export async function creaTicketAssistenza(
  input: unknown,
  config: EnvConfig
): Promise<CreaTicketAssistenzaOutput> {
  // Validazione input
  const parseResult = CreaTicketAssistenzaInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi per creazione ticket', parseResult.error.issues);
  }

  const { cliente, contatto, modulo_software, sommario_problema, descrizione_dettagliata, priorita } = parseResult.data;

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

    await query(
      `INSERT INTO tickets (id, numero, cliente, contatto, modulo_software, sommario_problema, descrizione_dettagliata, priorita, stato, data_creazione, data_aggiornamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NUOVO', ?, ?)`,
      [ticketId, numero, cliente, contatto, modulo_software, sommario_problema, descrizione_dettagliata, priorita, dataStr, dataStr],
      config
    );

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