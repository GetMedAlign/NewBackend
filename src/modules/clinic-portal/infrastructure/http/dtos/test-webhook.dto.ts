import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class TestWebhookDto {
  @ApiProperty({ description: 'The HTTPS URL to test the webhook delivery against' })
  @IsString()
  @IsNotEmpty()
  webhookUrl!: string;
}
