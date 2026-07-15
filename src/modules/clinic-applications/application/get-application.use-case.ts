import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_REPOSITORY,
  ApplicationDetail,
} from '../domain/ports/application-repository.port';
import type { ApplicationRepositoryPort } from '../domain/ports/application-repository.port';

export interface GetApplicationCtx {
  userId: string;
  role: string;
}

@Injectable()
export class GetApplicationUseCase {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly repo: ApplicationRepositoryPort,
  ) {}

  async execute(ctx: GetApplicationCtx, id: string): Promise<ApplicationDetail | null> {
    return this.repo.findById({ userId: ctx.userId, role: ctx.role }, id);
  }
}
