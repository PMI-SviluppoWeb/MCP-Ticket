# MCP Ticket Server

Model Context Protocol (MCP) Server per la gestione ticket di assistenza tecnica, con supporto per ricerca vettoriale (pgvector) e integrazione Retell AI via SSE.

## 🚀 Caratteristiche

- **Transport SSE** - Server-Sent Events per integrazione cloud (Retell AI, ecc.)
- **Autenticazione Bearer Token** - Sicurezza per endpoint MCP
- **PostgreSQL/Supabase** - Database relazionale con pgvector per embedding
- **4 Tools MCP** - Knowledge base, ticket management, client lookup
- **TypeScript Strict** - Type safety completa
- **Connection Pooling** - Gestione efficiente connessioni DB

## 📋 Tools Esposi

| Tool | Descrizione |
|------|-------------|
| `ricerca_knowledge_base` | Cerca soluzioni tecniche (vector + full-text fallback) |
| `crea_ticket_assistenza` | Crea nuovo ticket con priorità ALTA/MEDIA/BASSA |
| `verifica_stato_ticket` | Controlla stato e soluzione ticket esistente |
| `identifica_cliente_da_telefono` | Riconosce cliente da numero telefonico |

## 🛠 Installazione

```bash
# Clona e installa dipendenze
npm install

# Copia e configura variabili d'ambiente
cp .env.example .env
# Modifica .env con le tue credenziali

# Compila TypeScript
npm run build

# Inizializza database (crea tabelle, indici, dati esempio)
npm run db:init

# Avvia server
npm start

# Development con hot reload
npm run dev
```

## ⚙️ Configurazione (.env)

```env
# Server
PORT=3000
NODE_ENV=development

# MCP Auth (genera con: openssl rand -hex 32)
MCP_BEARER_TOKEN=your_secure_token_here

# Database - Opzione 1: PostgreSQL diretto
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Database - Opzione 2: Supabase
# SUPABASE_URL=https://xxx.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=xxx

# OpenAI (per embedding knowledge base)
OPENAI_API_KEY=sk-xxx
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Vector Search
VECTOR_SIMILARITY_THRESHOLD=0.7
VECTOR_MAX_RESULTS=5
```

## 🗄 Schema Database

Le tabelle vengono create automaticamente con `npm run db:init`:

```sql
-- Clienti
CREATE TABLE clienti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL,
  azienda VARCHAR(255),
  telefono VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tickets
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente VARCHAR(255) NOT NULL,
  contatto VARCHAR(255) NOT NULL,
  modulo_software VARCHAR(100) NOT NULL,
  sommario_problema VARCHAR(500) NOT NULL,
  descrizione_dettagliata TEXT NOT NULL,
  priorita VARCHAR(10) CHECK (priorita IN ('ALTA','MEDIA','BASSA')),
  stato VARCHAR(20) DEFAULT 'APERTO' CHECK (stato IN ('APERTO','IN_LAVORAZIONE','CHIUSO','ANNULLATO')),
  data_creazione TIMESTAMPTZ DEFAULT NOW(),
  soluzione TEXT
);

-- Knowledge Base (con pgvector)
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contenuto TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indice vettoriale HNSW per cosine similarity
CREATE INDEX idx_knowledge_base_embedding 
ON knowledge_base USING hnsw (embedding vector_cosine_ops);
```

## 🔌 Integrazione Retell AI

Configura Retell AI per chiamare il tuo MCP server:

```json
{
  "mcp_servers": [{
    "url": "https://your-domain.com/sse",
    "headers": {
      "Authorization": "Bearer YOUR_MCP_BEARER_TOKEN"
    }
  }]
}
```

L'endpoint SSE è: `https://your-domain.com/sse`
L'endpoint messaggi: `https://your-domain.com/messages?sessionId=<session_id>`

## 📝 Esempi Uso Tools

### ricerca_knowledge_base
```json
{
  "name": "ricerca_knowledge_base",
  "arguments": { "query": "errore connessione database postgresql" }
}
```

### crea_ticket_assistenza
```json
{
  "name": "crea_ticket_assistenza",
  "arguments": {
    "cliente": "Mario Rossi",
    "contatto": "mario@rossi.it",
    "modulo_software": "Fatturazione",
    "sommario_problema": "Errore calcolo IVA",
    "descrizione_dettagliata": "Il sistema applica IVA 22% invece di 10% per prodotti editoriali",
    "priorita": "ALTA"
  }
}
```

### verifica_stato_ticket
```json
{
  "name": "verifica_stato_ticket",
  "arguments": { "ticket_id": "uuid-del-ticket" }
}
```

### identifica_cliente_da_telefono
```json
{
  "name": "identifica_cliente_da_telefono",
  "arguments": { "telefono": "+39 02 1234567" }
}
```

## 🐳 Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
docker build -t mcp-ticket-server .
docker run -p 3000:3000 --env-file .env mcp-ticket-server
```

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/health

# Test SSE connection (richiede token)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/sse

# Lista tools via MCP
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  http://localhost:3000/messages?sessionId=xxx
```

## 📁 Struttura Progetto

```
src/
├── server.ts              # Entry point MCP + Express + SSE
├── types/index.ts         # TypeScript types & Zod schemas
├── db/
│   ├── pool.ts           # PostgreSQL connection pool
│   └── init.ts           # Database initialization & schema
├── auth/
│   └── middleware.ts     # Bearer token authentication
└── tools/
    ├── index.ts          # Tool registry & executor
    ├── ricercaKnowledgeBase.ts
    ├── creaTicketAssistenza.ts
    ├── verificaStatoTicket.ts
    └── identificaClienteDaTelefono.ts
```

## 🔒 Sicurezza

- **Bearer Token** obbligatorio per tutti gli endpoint MCP
- **Helmet.js** consigliato in produzione per headers sicurezza
- **Rate limiting** consigliato (express-rate-limit)
- **HTTPS** obbligatorio in produzione
- **Service Role Key** Supabase (non anon key) per accesso DB

## 📄 Licenza

MIT