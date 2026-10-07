# freightchain

Freight Chain – "Desert Run": a browser truck-driving game with a Solana-paid lobby.

- `client/` – the game and the site pages (vanilla ES modules + three.js)
- `server/` – NestJS + Prisma + PostgreSQL API (`docs/backend-architecture.md`)
- `deploy/` – semi-automatic deploy to our own server: `npm run deploy` (see `deploy/README.md`)
- `docs/` – hackathon plan, backend architecture
- `AGENTS.md` / `CLAUDE.md` – the project map and rules for coding agents

Local run: `npm run db:up && npm run server:dev` → http://localhost:3000
