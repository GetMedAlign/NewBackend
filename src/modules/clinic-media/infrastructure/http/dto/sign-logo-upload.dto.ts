import { IsIn, IsString } from 'class-validator';

export class SignLogoUploadDto {
  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  contentType!: string;
}
