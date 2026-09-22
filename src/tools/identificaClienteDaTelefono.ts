import { query } from '../db/pool';
import { EnvConfig, IdentificaClienteDaTelefonoOutput, ValidationError, MCPError, IdentificaClienteDaTelefonoInputSchema } from '../types';

/**
 * Normalizza un numero di telefono alle sole cifre.
 * Rimuove tutti i caratteri non numerici.
 */
function normalizzaTelefono(telefono: string): string {
  return telefono.replace(/\D/g, '');
}

export async function identificaClienteDaTelefono(
  input: unknown,
  config: EnvConfig
): Promise<IdentificaClienteDaTelefonoOutput> {
  // Validazione input
  const parseResult = IdentificaClienteDaTelefonoInputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError('Parametri non validi per identificazione cliente', parseResult.error.issues);
  }

  const { telefono } = parseResult.data;
  console.log(`[identificaClienteDaTelefono] Input ricevuto: "${telefono}"`);
  
  const cifre = normalizzaTelefono(telefono);
  console.log(`[identificaClienteDaTelefono] Cifre estratte: "${cifre}" (lunghezza: ${cifre.length})`);

  // Se non ci sono cifre, probabilmente è un placeholder non espanso
  if (cifre.length === 0) {
    return {
      trovato: false,
      messaggio: `Numero di telefono non valido: "${telefono}". Il numero deve contenere almeno 4 cifre.`,
    };
  }

  if (cifre.length < 4) {
    return {
      trovato: false,
      messaggio: `Numero di telefono troppo corto: "${telefono}". Inserire almeno 4 cifre.`,
    };
  }

  try {
    // Prima verifica la struttura della tabella clienti
    const schemaResult = await query<{ name: string }>(
      `PRAGMA table_info(clienti)`,
      [],
      config
    );
    const columns = schemaResult.rows.map(r => r.name);
    console.log(`[identificaClienteDaTelefono] Colonne tabella clienti: ${columns.join(', ')}`);

    // Trova i nomi delle colonne corrette
    const colNome = columns.find(c => c.toLowerCase().includes('nome') || c.toLowerCase().includes('name')) || 'nome';
    const colTelefono = columns.find(c => c.toLowerCase().includes('telefono') || c.toLowerCase().includes('phone')) || 'telefono';
    const colEmail = columns.find(c => c.toLowerCase().includes('email')) || 'email';
    const colAzienda = columns.find(c => c.toLowerCase().includes('azienda') || c.toLowerCase().includes('company') || c.toLowerCase().includes('ragione')) || 'azienda';

    console.log(`[identificaClienteDaTelefono] Colonne mappate: nome=${colNome}, telefono=${colTelefono}, email=${colEmail}, azienda=${colAzienda}`);

    // Cerca il cliente nella tabella clienti per telefono
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM clienti WHERE ${colTelefono} LIKE '%' || ? || '%' LIMIT 1`,
      [cifre],
      config
    );

    if (result.rows.length === 0) {
      return {
        trovato: false,
        messaggio: `Nessun cliente trovato con il numero di telefono: ${telefono}`,
      };
    }

    const cliente = result.rows[0] as Record<string, unknown>;
    const clienteNome = String(cliente[colNome] || '');
    const clienteTelefono = String(cliente[colTelefono] || '');
    const clienteEmail = String(cliente[colEmail] || '');
    const clienteAzienda = String(cliente[colAzienda] || '');

    // Cerca i ticket recenti del cliente
    const ticketResult = await query<{
      numero: string;
      stato: string;
      sommario_problema: string;
    }>(
      `SELECT numero, stato, sommario_problema
       FROM tickets
       WHERE cliente = ?
       ORDER BY data_creazione DESC
       LIMIT 5`,
      [clienteNome],
      config
    );

    return {
      trovato: true,
      cliente: {
        nome: clienteNome,
        telefono: clienteTelefono,
        email: clienteEmail,
        azienda: clienteAzienda,
      },
      ticket_recenti: ticketResult.rows.map(r => ({
        numero: r.numero,
        stato: r.stato,
        sommario_problema: r.sommario_problema,
      })),
    };
  } catch (error) {
    if (error instanceof MCPError) throw error;

    console.error('Errore identificazione cliente:', error);
    throw new MCPError(
      'Errore durante la ricerca del cliente per telefono',
      'CLIENT_LOOKUP_ERROR',
      500
    );
  }
}
