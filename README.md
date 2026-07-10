# MedAlign Backend

Hexagonal NestJS + Prisma + Supabase backend with Postgres Row-Level Security (RLS).

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Hexagonal design principles

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Supabase account (or local instance)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your secrets

# 3. Apply database migrations
npm run prisma:migrate:dev

# 4. Start dev server
npm run dev
```

Server runs on `http://localhost:3000`

## Security Architecture

### Row-Level Security (RLS)

Every table has Postgres RLS policies:

- **clients**: Client can read own, admin can read all
- **user_roles**: User can read own, admin can manage
- **audit_log**: Admin can read, no client writes

### Session Context

Per-request middleware sets Postgres session variables:

- `app.current_user_id` (UUID)
- `app.current_user_type` ('admin' | 'partner' | 'client')
- `app.current_ip_address` (IP)

RLS policies evaluate via: `current_setting('app.current_user_id')`

### Audit Logging

Automatic audit trail via Postgres triggers:

1. Every table mutation fires trigger
2. Trigger reads session context
3. Calls `append_audit_log()` function
4. Audit log is append-only (immutable)

## Development

### Folder Structure

```
src/
├── core/
│   ├── domain/           # Pure business logic
│   │   ├── entities/     # Domain objects
│   │   └── repositories/ # PORT interfaces
│   └── use-cases/        # Application logic
├── infrastructure/       # ADAPTERS
│   ├── database/         # Prisma
│   ├── repositories/     # Implementations
│   ├── http/             # Controllers
│   ├── config/           # Configuration
│   └── supabase/         # Auth
└── common/               # Shared utilities
```

### Commands

```bash
# Development
npm run dev              # Watch mode
npm run build            # Production build
npm start                # Run built app

# Testing
npm test                 # Run unit tests
npm run test:watch       # Watch mode
npm run test:integration # Integration tests

# Database
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate:dev  # Create migration
npm run prisma:migrate:deploy  # Apply migrations
npm run prisma:seed      # Run seed script

# Code Quality
npm run lint             # ESLint
npm run format           # Prettier
```

## API Endpoints (Phase 1)

```bash
# Health
GET /health
  → { "status": "ok" }

# Auth (requires JWT)
GET /auth/me
  → { "userId": "...", "email": "...", "userType": "..." }

GET /auth/role
  → { "role": "admin" | "partner" | "client" }

# Clients (requires JWT, RLS enforced)
GET /clients/me
  → { "clientId": "...", "email": "...", "createdAt": "..." }
```

## Phases

- **Phase 1:** Auth + RLS ✅ (this repo)
- **Phase 2:** Audit logging service
- **Phase 3:** PII encryption (AES-256-GCM)
- **Phase 4:** Extended config + secrets
- **Phase 5:** Testing + error handling
- **Phase 6:** Feature modules (claims, payments, etc.)

## Testing Strategy

### Unit Tests

Domain logic isolated from framework:

```typescript
describe('ClientEntity', () => {
  it('should determine ownership', () => {
    const client = new ClientEntity(...);
    expect(client.isOwnedBy('user-123')).toBe(true);
  });
});
```

### Integration Tests

Full stack including RLS:

```typescript
describe("RLS", () => {
  it("client should not read other clients' data", async () => {
    await prisma.setSessionContext("client-user", "client", "127.0.0.1");
    const result = await prisma.client.findUnique({
      where: { id: "other-client-id" },
    });
    expect(result).toBeNull(); // RLS blocks it
  });
});
```

## Implementation Plan

See **[docs/superpowers/plans/2026-07-10-phase-1-auth-rls.md](./docs/superpowers/plans/2026-07-10-phase-1-auth-rls.md)** for:

- 10 bite-sized tasks
- Complete code for each task
- Test commands
- Commit messages
- Exact file paths

## References

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
- [Postgres Session Variables](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET)
