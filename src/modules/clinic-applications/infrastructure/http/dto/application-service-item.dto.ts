import { ApiProperty } from '@nestjs/swagger';

export class ApplicationServiceItemDto {
  @ApiProperty({ description: 'Service code' })
  serviceCode!: string;

  @ApiProperty({ description: 'Whether this is a top service' })
  isTopService!: boolean;

  @ApiProperty({ description: 'Display order (ascending)' })
  displayOrder!: number;
}
