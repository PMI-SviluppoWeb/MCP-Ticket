export { ricercaKnowledgeBase } from './ricercaKnowledgeBase';
export { creaTicketAssistenza } from './creaTicketAssistenza';
export { verificaStatoTicket } from './verificaStatoTicket';
export { identificaClienteDaTelefono } from './identificaClienteDaTelefono';
export { ricercaDocumentazioneLive } from './ricercaDocumentazioneLive';

import { MCP_TOOLS } from '../types';
import { ricercaKnowledgeBase } from './ricercaKnowledgeBase';
import { creaTicketAssistenza } from './creaTicketAssistenza';
import { verificaStatoTicket } from './verificaStatoTicket';
import { identificaClienteDaTelefono } from './identificaClienteDaTelefono';
import { ricercaDocumentazioneLive } from './ricercaDocumentazioneLive';
import { EnvConfig } from '../types';

export const TOOL_HANDLERS = {
  [MCP_TOOLS.ricerca_knowledge_base.name]: ricercaKnowledgeBase,
  [MCP_TOOLS.crea_ticket_assistenza.name]: creaTicketAssistenza,
  [MCP_TOOLS.verifica_stato_ticket.name]: verificaStatoTicket,
  [MCP_TOOLS.identifica_cliente_da_telefono.name]: identificaClienteDaTelefono,
  [MCP_TOOLS.ricerca_documentazione_live.name]: ricercaDocumentazioneLive,
} as const;

export type ToolName = keyof typeof TOOL_HANDLERS;

export async function executeTool(
  name: ToolName,
  input: unknown,
  config: EnvConfig
) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    throw new Error(`Tool non trovato: ${name}`);
  }
  return handler(input, config);
}