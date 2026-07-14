import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClinicPhotoRepositoryPort } from '../domain/ports/clinic-photo-repository.port';

@Injectable()
export class PrismaClinicPhotoRepository implements ClinicPhotoRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getLogoUrl(clinicId: string): Promise<string | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const clinic = await tx.clinic.findUnique({
          where: { id: clinicId },
          select: { logoUrl: true },
        });
        return clinic?.logoUrl ?? null;
      },
    );
  }

  async setLogoUrl(clinicId: string, url: string): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        await tx.clinic.update({
          where: { id: clinicId },
          data: { logoUrl: url },
        });
      },
    );
  }

  async listPhotoUrls(clinicId: string): Promise<string[]> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const photos = await tx.clinicPhoto.findMany({
          where: { clinicId },
          orderBy: { displayOrder: 'asc' },
          select: { url: true },
        });
        return photos.map((p) => p.url);
      },
    );
  }

  async replacePhotos(clinicId: string, urls: string[]): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        await tx.clinicPhoto.deleteMany({ where: { clinicId } });
        await tx.clinicPhoto.createMany({
          data: urls.map((url, index) => ({
            clinicId,
            url,
            displayOrder: index,
          })),
        });
        await tx.clinic.update({
          where: { id: clinicId },
          data: { photoCount: urls.length },
        });
      },
    );
  }
}
