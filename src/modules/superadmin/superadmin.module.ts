import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ListAdminsUseCase } from './application/list-admins.use-case';
import { CreateAdminUseCase } from './application/create-admin.use-case';
import { DeleteAdminUseCase } from './application/delete-admin.use-case';
import { SetAdminPasswordUseCase } from './application/set-admin-password.use-case';
import { ADMIN_TEAM_REPOSITORY } from './domain/ports/admin-team-repository.port';
import { PrismaAdminTeamRepository } from './infrastructure/prisma-admin-team.repository';
import { SuperadminController } from './infrastructure/http/superadmin.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SuperadminController],
  providers: [
    ListAdminsUseCase,
    CreateAdminUseCase,
    DeleteAdminUseCase,
    SetAdminPasswordUseCase,
    { provide: ADMIN_TEAM_REPOSITORY, useClass: PrismaAdminTeamRepository },
  ],
})
export class SuperadminModule {}
