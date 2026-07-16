import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Env } from '../../infrastructure/config/env.schema';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { STORAGE_PORT } from './domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from './domain/ports/clinic-photo-repository.port';
import { SupabaseStorageAdapter } from './infrastructure/supabase-storage.adapter';
import { PrismaClinicPhotoRepository } from './infrastructure/prisma-clinic-photo.repository';
import { SignLogoUploadUseCase } from './application/sign-logo-upload.use-case';
import { SignPhotoUploadsUseCase } from './application/sign-photo-uploads.use-case';
import { ConfirmLogoUseCase } from './application/confirm-logo.use-case';
import { ConfirmPhotosUseCase } from './application/confirm-photos.use-case';
import { ListPhotosUseCase } from './application/list-photos.use-case';
import { ClinicMediaController } from './infrastructure/http/clinic-media.controller';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [ClinicMediaController],
  providers: [
    SignLogoUploadUseCase,
    SignPhotoUploadsUseCase,
    ConfirmLogoUseCase,
    ConfirmPhotosUseCase,
    ListPhotosUseCase,
    {
      provide: STORAGE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new SupabaseStorageAdapter({
          url: config.getOrThrow<string>('SUPABASE_URL'),
          serviceRoleKey: config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          bucket: config.getOrThrow<string>('SUPABASE_STORAGE_BUCKET'),
        }),
    },
    {
      provide: CLINIC_PHOTO_REPOSITORY,
      useClass: PrismaClinicPhotoRepository,
    },
  ],
  exports: [STORAGE_PORT],
})
export class ClinicMediaModule {}
