import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { NotifyResponseDto } from '../domain/localization.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CaptureNotifyUseCase {
  constructor(@Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort) {}

  async execute(input: { email: string; citySlug: string | null }): Promise<NotifyResponseDto> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320) {
      throw new BadRequestException('A valid email is required');
    }
    await this.repo.insertNotify(email, input.citySlug ?? null);
    return { ok: true };
  }
}
