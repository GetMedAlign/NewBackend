import { IsString, IsNotEmpty } from 'class-validator';

export class TestWebhookDto {
  @IsString()
  @IsNotEmpty()
  webhookUrl!: string;
}
