import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for GET /clinics. Field names match the frontend's
 * `ClinicDirectoryItem` / `ClinicDirectoryResponse` in
 * Medalign-frontend/app/api/client.ts exactly (camelCase, same keys).
 */
export class ClinicDirectoryItemDto {
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
  city!: string;

  @ApiProperty()
  stateCode!: string;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  reviewCount!: number;

  @ApiProperty()
  telehealth!: boolean;

  @ApiProperty({ type: [String] })
  topServices!: string[];

  @ApiProperty({ type: String, nullable: true })
  consultationFee!: string | null;

  @ApiProperty({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  websiteUrl!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  distanceMiles!: number | null;
}

export class ClinicDirectoryResponseDto {
  @ApiProperty({ type: [ClinicDirectoryItemDto] })
  items!: ClinicDirectoryItemDto[];

  @ApiProperty()
  totalCount!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  totalPages!: number;
}
