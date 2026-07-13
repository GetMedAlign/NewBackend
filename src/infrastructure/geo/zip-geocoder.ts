import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ZipLookupResult {
  lat: number;
  lng: number;
  state: string;
}

@Injectable()
export class ZipGeocoder {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a ZIP code in the zip_codes table (parameterized query via
   * PrismaService.asSystem) and returns lat/lng/state, or null if not found.
   */
  async lookup(zip: string): Promise<ZipLookupResult | null> {
    const row = await this.prisma.asSystem((client) =>
      client.zipCode.findUnique({
        where: { zip },
        select: { latitude: true, longitude: true, stateCode: true },
      }),
    );
    if (!row) return null;
    return { lat: row.latitude, lng: row.longitude, state: row.stateCode };
  }
}
