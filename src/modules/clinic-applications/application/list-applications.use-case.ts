import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_REPOSITORY,
  ApplicationSummary,
} from '../domain/ports/application-repository.port';
import type { ApplicationRepositoryPort } from '../domain/ports/application-repository.port';

export interface ListApplicationsCtx {
  userId: string;
  role: string;
}

@Injectable()
export class ListApplicationsUseCase {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly repo: ApplicationRepositoryPort,
  ) {}

  async execute(ctx: ListApplicationsCtx): Promise<ApplicationSummary[]> {
    return this.repo.list({ userId: ctx.userId, role: ctx.role });
  }
}
