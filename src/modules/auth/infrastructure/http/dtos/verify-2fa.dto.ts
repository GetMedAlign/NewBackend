import { IsEmail, IsString } from 'class-validator';

export class Verify2faDto {
  @IsEmail()
  email!: string;

  @IsString()
  code!: string;
}
