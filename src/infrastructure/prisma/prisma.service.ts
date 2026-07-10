import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient, Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from './request-context';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;
  private readonly client: PrismaClient;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
    });
    const adapter = new PrismaPg(this.pool);
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    await this.pool.end();
  }

  /**
   * Opens an interactive transaction, sets the three RLS session variables
   * as transaction-local (set_config(..., true)), then calls fn with the
   * transaction client. The session vars are never visible outside this TX.
   */
  async withUserContext<T>(
    ctx: RequestContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id',   ${ctx.userId ?? ''},  true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_role',  ${ctx.role ?? ''},   true)`;
      await tx.$executeRaw`SELECT set_config('app.current_ip_address', ${ctx.ip ?? ''},     true)`;
      return fn(tx);
    });
  }

  /**
   * Runs fn with the base Prisma client, without setting any session context.
   * Use for signup and other system paths that do not operate on behalf of a
   * specific user.
   */
  async asSystem<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
    return fn(this.client);
  }
}
