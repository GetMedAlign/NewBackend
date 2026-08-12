import { Inject, Injectable } from '@nestjs/common';
import { SCHEDULING_REPOSITORY } from '../domain/ports/scheduling-repository.port';
import type {
  SchedulingProvider,
  SchedulingRepositoryPort,
} from '../domain/ports/scheduling-repository.port';

export type SchedulingStatus = {
  provider: SchedulingProvider;
  connected: boolean;
  schedulingUrl: string | null;
};

/**
 * Returns the scheduling connection status for a clinic. Deliberately
 * strips the encrypted access token and webhook URI from the repository's
 * read model — this is the only shape ever returned to the client.
 */
@Injectable()
export class GetSchedulingStatusUseCase {
  constructor(
    @Inject(SCHEDULING_REPOSITORY)
    private readonly repo: SchedulingRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<SchedulingStatus> {
    const state = await this.repo.getSchedulingState(clinicId);
    return {
      provider: state.provider,
      connected: state.provider !== 'none',
      schedulingUrl: state.schedulingUrl,
    };
  }
}
