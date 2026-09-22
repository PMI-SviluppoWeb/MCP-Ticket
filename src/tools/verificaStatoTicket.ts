import { query } from '../db/pool';
import { EnvConfig, VerificaStatoTicketOutput, ValidationError, MCPError, NotFoundError, VerificaStatoTicketInputSchema, TicketStatus, TicketPriority } from '../types';

export async function verificaStatoTicket(
  input: unknown,
  config: EnvConfig
): Promise<VerificaStatoTicketOutput> {
  // Validazione input
  const parseResult = VerificaStatoTicketInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi per verifica ticket', parseResult.error.issues);
  }

  const { ticket_id } = parseResult.data;

  // Il cliente conosce il numero (es. TICK-0003); l'app usa l'id interno.
  // Accettiamo entrambi, normalizzando il numero in maiuscolo.
  const criterio = ticket_id.trim();
  const numeroNormalizzato = criterio.toUpperCase();

  try {
    const result = await query<{
      id: string;
      numero: string;
      stato: string;
      note: string | null;
      operatore: string | null;
      data_creazione: string;
      data_aggiornamento: string;
      data_chiusura: string | null;
      cliente: string;
      modulo_software: string;
      priorita: string;
      sommario_problema: string;
    }>(
      `SELECT id, numero, stato, note, operatore,
              data_creazione, data_aggiornamento, data_chiusura,
              cliente, modulo_software, priorita, sommario_problema
       FROM tickets
       WHERE numero = ? OR id = ?`,
      [numeroNormalizzato, criterio],
      config
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Ticket', ticket_id);
    }

    const ticket = result.rows[0];

    return {
      ticket_id: ticket.id,
      numero: ticket.numero,
      stato: ticket.stato as TicketStatus,
      note: ticket.note,
      operatore: ticket.operatore,
      data_creazione: ticket.data_creazione,
      data_aggiornamento: ticket.data_aggiornamento,
      data_chiusura: ticket.data_chiusura,
      cliente: ticket.cliente,
      modulo_software: ticket.modulo_software,
      priorita: ticket.priorita as TicketPriority,
      sommario_problema: ticket.sommario_problema,
    };
  } catch (error) {
    if (error instanceof MCPError) throw error;

    console.error('Errore verifica stato ticket:', error);
    throw new MCPError(
      'Errore durante la verifica dello stato del ticket',
      'TICKET_STATUS_ERROR',
      500
    );
  }
}
