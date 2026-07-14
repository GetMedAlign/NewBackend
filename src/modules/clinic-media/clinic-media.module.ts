import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Env } from '../../infrastructure/config/env.schema';
import { STORAGE_PORT } from './domain/ports/storage.port';
import { SupabaseStorageAdapter } from './infrastructure/supabase-storage.adapter';
import { SignLogoUploadUseCase } from './application/sign-logo-upload.use-case';
import { SignPhotoUploadsUseCase } from './application/sign-photo-uploads.use-case';
import { ClinicMediaController } from './infrastructure/http/clinic-media.controller';

@Module({
  imports: [ConfigModule],
  controllers: [ClinicMediaController],
  providers: [
    SignLogoUploadUseCase,
    SignPhotoUploadsUseCase,
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
  ],
})
export class ClinicMediaModule {}
