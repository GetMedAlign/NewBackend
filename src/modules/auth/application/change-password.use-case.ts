import { Injectable, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common';

import { UserRepositoryPort, USER_REPOSITORY } from '../domain/ports/user-repository.port';
import { PasswordHasherPort, PASSWORD_HASHER } from '../domain/ports/password-hasher.port';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await this.hasher.verify(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await this.hasher.hash(newPassword);
    await this.users.updatePasswordHash(userId, passwordHash);
    return { success: true };
  }
}
