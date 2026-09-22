import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { randomUUID } from 'crypto';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ListToolsResult,
  CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';

// Carica variabili d'ambiente PRIMA di tutto
dotenv.config({ path: join(process.cwd(), '.env') });

import { EnvConfig, MCP_TOOLS, MCPError } from './types';
import { getClient, closeClient, healthCheck } from './db/pool';
import { createErrorHandler } from './auth/middleware';
import { TOOL_HANDLERS, ToolName, executeTool } from './tools';

// Configurazione ambiente
const config: EnvConfig = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MCP_BEARER_TOKEN: process.env.MCP_BEARER_TOKEN || '',
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  // Supporta sia TURSO_AUTH_TOKEN che SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_SERVICE_ROLE_KEY: process.env.TURSO_AUTH_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  VECTOR_SIMILARITY_THRESHOLD: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD || '0.7'),
  VECTOR_MAX_RESULTS: parseInt(process.env.VECTOR_MAX_RESULTS || '5', 10),
};

// Inizializza Express
const app = express();
app.use(cors());
app.use(express.json());

// Middleware autenticazione - DISABILITATO per troubleshooting
// const authMiddleware = createAuthMiddleware(config);
// app.use(authMiddleware);

// Error handler
app.use(createErrorHandler(config));

// Health check endpoint (senza auth)
app.get('/health', async (req: Request, res: Response) => {
  const dbHealthy = await healthCheck(config);
  res.json({
    status: dbHealthy ? 'healthy' : 'degraded',
    database: dbHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Root endpoint info
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'MCP Ticket Server',
    version: '1.0.0',
    description: 'Model Context Protocol server per gestione ticket assistenza',
    transport: 'SSE',
    endpoints: {
      sse: '/sse',
      messages: '/messages',
      health: '/health',
    },
    tools: Object.values(MCP_TOOLS).map(t => t.name),
  });
});

// Factory: crea un MCP Server con gli handler registrati (uno per connessione)
function createMcpServer(): Server {
  const mcpServer = new Server(
    {
      name: 'mcp-ticket-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Type helper per convertire gli schema Zod in JSON Schema compatibile MCP
  function toMCPToolSchema(tool: typeof MCP_TOOLS[keyof typeof MCP_TOOLS]) {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object' as const,
        properties: tool.inputSchema.properties,
        required: Array.isArray(tool.inputSchema.required) ? [...tool.inputSchema.required] : [],
      },
    };
  }

  // Registra handlers MCP
  mcpServer.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    const tools = Object.values(MCP_TOOLS).map(toMCPToolSchema);
    return { tools };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    console.log(`[MCP] Tool chiamato: ${name}`, args);

    try {
      const toolName = name as ToolName;
      const result = await executeTool(toolName, args, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(`[MCP] Errore tool ${name}:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      const errorCode = error instanceof MCPError ? error.code : 'TOOL_EXECUTION_ERROR';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              code: errorCode,
              message: errorMessage,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return mcpServer;
}

// SSE Transport
const transports: Map<string, SSEServerTransport> = new Map();

app.get('/sse', async (req: Request, res: Response) => {
  console.log('[SSE] Nuova connessione SSE');

  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;

  transports.set(sessionId, transport);

  // Cleanup su disconnessione
  res.on('close', () => {
    console.log(`[SSE] Connessione chiusa: ${sessionId}`);
    transports.delete(sessionId);
  });

  try {
    await createMcpServer().connect(transport);
    console.log(`[SSE] mcpServer.connect completato per sessione: ${sessionId}`);
  } catch (e) {
    console.error(`[SSE] Errore mcpServer.connect:`, e);
    transport.close();
    transports.delete(sessionId);
    res.status(500).json({ error: 'Errore nella connessione SSE' });
    return;
  }
});

app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`[POST /messages] SessionId: ${sessionId}`);

  const transport = transports.get(sessionId);

  if (!transport) {
    console.log(`[POST /messages] Transport non trovato per sessione: ${sessionId}`);
    res.status(404).json({ error: 'Sessione SSE non trovata' });
    return;
  }

  console.log(`[POST /messages] Transport trovato, calling handlePostMessage`);
  try {
    await transport.handlePostMessage(req, res, req.body);
    console.log(`[POST /messages] handlePostMessage completato`);
  } catch (e) {
    console.error(`[POST /messages] Errore handlePostMessage:`, e);
    throw e;
  }
});

// ============================================
// Streamable HTTP Transport (richiesto da Retell.ai)
// Endpoint /mcp: gestisce POST/GET/DELETE secondo spec MCP Streamable HTTP
// ============================================
const streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

async function handleMcpRequest(req: Request, res: Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport = sessionId ? streamableTransports.get(sessionId) : undefined;

  if (!transport) {
    // Nuova sessione: ammessa solo su richiesta di inizializzazione (POST senza session id)
    if (sessionId || req.method !== 'POST') {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: sessione non valida o mancante' },
        id: null,
      });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        console.log(`[MCP HTTP] Sessione inizializzata: ${sid}`);
        streamableTransports.set(sid, transport!);
      },
    });

    transport.onclose = () => {
      const sid = transport!.sessionId;
      if (sid) {
        console.log(`[MCP HTTP] Sessione chiusa: ${sid}`);
        streamableTransports.delete(sid);
      }
    };

    await createMcpServer().connect(transport);
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[MCP HTTP] Errore handleRequest:', e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Errore interno del server' },
        id: null,
      });
    }
  }
}

app.post('/mcp', handleMcpRequest);
app.get('/mcp', handleMcpRequest);
app.delete('/mcp', handleMcpRequest);

// Avvio server
async function startServer() {
  try {
    // Test connessione database
    console.log('Verifica connessione database...');
    const dbHealthy = await healthCheck(config);
    
    if (!dbHealthy) {
      console.error('❌ Impossibile connettersi al database. Verifica DATABASE_URL');
      process.exit(1);
    }
    
    console.log('✅ Database connesso');
    
    const server = app.listen(config.PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MCP Ticket Server - Model Context Protocol                 ║
╠══════════════════════════════════════════════════════════════╣
║  Server avviato su http://localhost:${config.PORT}               ║
║  SSE Endpoint: http://localhost:${config.PORT}/sse               ║
║  Messages:     http://localhost:${config.PORT}/messages          ║
║  Health:       http://localhost:${config.PORT}/health            ║
╠══════════════════════════════════════════════════════════════╣
║  Tools disponibili:                                          ║
║  • ricerca_knowledge_base                                    ║
║  • ricerca_documentazione_live                               ║
║  • crea_ticket_assistenza                                    ║
║  • verifica_stato_ticket                                     ║
║  • identifica_cliente_da_telefono                            ║
╠═══════════════════════════════════════════════════════════════╣
║  Autenticazione: DISABILITATA (nessuna auth richiesta)          ║
║  Database: ${config.DATABASE_URL?.startsWith('libsql') ? 'Turso/libSQL' : 'PostgreSQL'}      ║
║  Vector Search: ${config.OPENAI_API_KEY ? 'OpenAI Embeddings' : 'Full-text fallback'}            ║
╚═══════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} ricevuto, spegnimento in corso...`);
      
      server.close(async () => {
        console.log('Server HTTP chiuso');
        
        // Chiudi tutte le connessioni SSE
        for (const [sessionId, transport] of transports) {
          try {
            await transport.close();
          } catch (e) {
            console.error(`Errore chiusura transport ${sessionId}:`, e);
          }
        }
        transports.clear();

        // Chiudi tutte le connessioni Streamable HTTP
        for (const [sessionId, transport] of streamableTransports) {
          try {
            await transport.close();
          } catch (e) {
            console.error(`Errore chiusura transport streamable ${sessionId}:`, e);
          }
        }
        streamableTransports.clear();

        // Chiudi pool database
        await closeClient();
        
        console.log('Spegnimento completato');
        process.exit(0);
      });
      
      // Force exit after 10s
      setTimeout(() => {
        console.error('Force exit dopo timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error('Errore avvio server:', error);
    process.exit(1);
  }
}

startServer();