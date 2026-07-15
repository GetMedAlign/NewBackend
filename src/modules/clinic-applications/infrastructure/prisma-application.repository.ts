import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ApplicationRepositoryPort,
  SubmitApplicationInput,
} from '../domain/ports/application-repository.port';

@Injectable()
export class PrismaApplicationRepository implements ApplicationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: SubmitApplicationInput): Promise<{ applicationId: string }> {
    return this.prisma.asSystem((client) =>
      client.$transaction(async (tx) => {
        const application = await tx.clinicApplication.create({
          data: {
            clinicName: input.clinicName,
            contactEmail: input.contactEmail,
            businessEmail: input.businessEmail ?? null,
            city: input.city ?? null,
            stateCode: input.stateCode ?? null,
            zipCode: input.zipCode ?? null,
            websiteUrl: input.websiteUrl ?? null,
            telehealthAvailable: input.telehealthAvailable ?? false,
            offersLabWork: input.offersLabWork ?? false,
            newPatientWait: input.newPatientWait ?? null,
            npiNumber: input.npiNumber ?? null,
            stateLicenseNumber: input.stateLicenseNumber ?? null,
            consultationFeeBand: input.consultationFeeBand ?? null,
            monthlyProgramBand: input.monthlyProgramBand ?? null,
            financingAvailable: input.financingAvailable ?? false,
            insuranceAccepted: input.insuranceAccepted ?? false,
            insuranceNotes: input.insuranceNotes ?? null,
            about: input.about ?? null,
            differentiators: input.differentiators ?? null,
            providerName: input.providerName ?? null,
            credentials: input.credentials ?? null,
            logoUrl: input.logoUrl ?? null,
            photoUrls:
              input.photoUrls != null
                ? (input.photoUrls as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            status: 'pending',
          },
          select: { id: true },
        });

        if (input.categories.length > 0) {
          await tx.$executeRaw`
            INSERT INTO application_categories (application_id, category)
            SELECT ${application.id}::uuid, unnest(${input.categories}::assessment_category[])
            ON CONFLICT (application_id, category) DO NOTHING
          `;
        }

        if (input.services.length > 0) {
          await tx.applicationService.createMany({
            data: input.services.map((svc) => ({
              applicationId: application.id,
              serviceCode: svc.serviceCode,
              isTopService: svc.isTopService,
              displayOrder: svc.displayOrder,
            })),
          });
        }

        return { applicationId: application.id };
      }),
    );
  }
}
