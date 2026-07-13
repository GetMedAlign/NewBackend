import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ZipGeocoder } from './zip-geocoder';

@Module({
  imports: [PrismaModule],
  providers: [ZipGeocoder],
  exports: [ZipGeocoder],
})
export class GeoModule {}
