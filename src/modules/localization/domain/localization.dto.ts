import { ApiProperty } from '@nestjs/swagger';

export class MetaDto {
  @ApiProperty() path!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() robots!: boolean;
}

export class ClinicListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: [String] }) services!: string[];
  @ApiProperty() telehealth!: boolean;
}

export class NamedCountDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() count!: number;
}

export class CityListItemDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() clinicCount!: number;
}

export class CityListDto {
  @ApiProperty({ type: [CityListItemDto] }) cities!: CityListItemDto[];
}

export class CityDetailDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() area!: string;
  @ApiProperty() intro!: string;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [ClinicListItemDto] }) telehealthClinics!: ClinicListItemDto[];
  @ApiProperty({ type: [NamedCountDto] }) services!: NamedCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) nearbyCities!: NamedCountDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class ServiceListItemDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() cityCount!: number;
}

export class ServiceListDto {
  @ApiProperty({ type: [ServiceListItemDto] }) services!: ServiceListItemDto[];
}

export class ServiceDetailDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [NamedCountDto] }) cities!: NamedCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) relatedServices!: NamedCountDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class ComboDetailDto {
  @ApiProperty() citySlug!: string;
  @ApiProperty() serviceSlug!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [ClinicListItemDto] }) nearbyClinics!: ClinicListItemDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class CoverageCellDto {
  @ApiProperty() citySlug!: string;
  @ApiProperty() count!: number;
  @ApiProperty() state!: string; // published | below_threshold | none
}

export class CoverageRowDto {
  @ApiProperty() serviceSlug!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [CoverageCellDto] }) cells!: CoverageCellDto[];
}

export class CoverageDto {
  @ApiProperty() minClinics!: number;
  @ApiProperty({ type: [CityListItemDto] }) cities!: CityListItemDto[];
  @ApiProperty({ type: [CoverageRowDto] }) matrix!: CoverageRowDto[];
}

export class NotifyResponseDto {
  @ApiProperty() ok!: boolean;
}
