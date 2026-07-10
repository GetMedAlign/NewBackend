# MedAlign Backend - Hexagonal Architecture

## Principles

- **Domain Layer:** Pure business logic, zero framework dependencies
- **Application Layer:** Use cases orchestrating domain + ports
- **Adapter Layer:** Concrete implementations (Prisma, HTTP, Supabase)
- **Ports:** Interfaces defining what domain needs from infrastructure
- **RLS Enforcement:** Postgres policies at database boundary, not application

## Folder Structure

```
src/
├── core/domain/               # Pure business logic
│   ├── entities/              # Domain objects (no framework)
│   ├── repositories/          # PORTS (interfaces only)
│   └── value-objects/         # Immutable value types
├── core/use-cases/            # Application orchestration
│   └── {feature}/             # Each use case isolated
├── infrastructure/            # ADAPTERS (implementations)
│   ├── repositories/          # Prisma implementations of ports
│   ├── database/              # Prisma + RLS wiring
│   ├── http/                  # Controllers, guards, middleware
│   ├── config/                # Configuration
│   └── supabase/              # Auth wrapper
└── common/                    # Shared utilities
```

## Security Pattern

1. **JWT Auth:** JwtAuthGuard validates Supabase JWT
2. **Session Context:** Middleware sets Postgres session vars: `app.current_user_id`, `app.current_user_type`, `app.current_ip_address`
3. **RLS Policies:** Postgres policies evaluate session context
4. **Audit Triggers:** Automatic audit on every INSERT/UPDATE/DELETE

Example RLS policy:
```sql
CREATE POLICY "Client can read own record" ON "clients"
  FOR SELECT USING (auth.uid() = "auth_user_id");
```

## Testing Strategy

- **Unit Tests:** Domain logic isolated from framework
- **Integration Tests:** Full stack including RLS enforcement
- **Mocking:** Mock interfaces (ports), not implementations
