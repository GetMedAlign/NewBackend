import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';
import { ENCRYPTION_PORT } from '../../modules/auth/domain/ports/encryption.port';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ENCRYPTION_PORT,
      useClass: AesGcmEncryptionService,
    },
  ],
  exports: [ENCRYPTION_PORT],
})
export class CryptoModule {}
