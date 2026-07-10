import { Injectable, Inject } from '@nestjs/common';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.error';
import {
  UserRepositoryPort,
  USER_REPOSITORY,
} from '../domain/ports/user-repository.port';

export interface GetMeInput {
  userId: string;
}

export interface GetMeOutput {
  userId: string;
  email: string;
  role: string;
}

@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: UserRepositoryPort,
  ) {}

  async execute(input: GetMeInput): Promise<GetMeOutput> {
    const user = await this.repo.findById(input.userId);

    if (user === null) {
      throw new InvalidCredentialsError();
    }

    const role = await this.repo.getPrimaryRole(user.id);

    return { userId: user.id, email: user.email, role };
  }
}
