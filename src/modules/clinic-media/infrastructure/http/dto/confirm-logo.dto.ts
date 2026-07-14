import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmLogoDto {
  @IsString()
  @IsNotEmpty()
  path!: string;
}
