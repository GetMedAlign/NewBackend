import { ApiProperty } from '@nestjs/swagger';

export class AuthorizeUrlDto {
  @ApiProperty({ description: 'Calendly OAuth authorize URL to redirect the clinic user to' })
  authorizeUrl!: string;
}
