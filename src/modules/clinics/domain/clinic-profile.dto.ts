import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for GET /clinics/:slug. Field names match the subset of
 * `MockClinic` (Medalign-frontend/app/data/clinics.ts) that
 * `app/routes/clinic-detail.tsx` actually reads, and mirror .NET's
 * ClinicPublicDto field-for-field (Services = top services, AllServices =
 * every service code).
 *
 * `score` is intentionally omitted: it is a per-assessment match score (see
 * ClinicMatchDto from the recommendations module) that has no meaning for a
 * standalone profile lookup, is not on .NET's ClinicPublicDto either, and is
 * never read by the clinic-detail page.
 */
export class ClinicProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty()
  specialty!: string;

  @ApiProperty()
  location!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  stateCode!: string;

  @ApiProperty()
  zipCode!: string;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  reviewCount!: number;

  @ApiProperty()
  about!: string;

  @ApiProperty()
  differentiators!: string;

  @ApiProperty({ type: [String] })
  services!: string[];

  @ApiProperty({ type: [String] })
  allServices!: string[];

  @ApiProperty()
  waitTime!: string;

  @ApiProperty()
  telehealth!: boolean;

  @ApiProperty()
  offersLabWork!: boolean;

  @ApiProperty({ type: String, nullable: true })
  websiteUrl!: string | null;

  @ApiProperty()
  consultationFee!: string;

  @ApiProperty()
  monthlyProgram!: string;

  @ApiProperty()
  financing!: boolean;

  @ApiProperty()
  insurance!: boolean;

  @ApiProperty()
  providerName!: string;

  @ApiProperty()
  credentials!: string;

  @ApiProperty()
  photoCount!: number;

  @ApiProperty({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiProperty({ type: [String] })
  photoUrls!: string[];
}
