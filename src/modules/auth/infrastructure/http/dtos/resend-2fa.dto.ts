import { IsEmail } from 'class-validator';

export class Resend2faDto {
  @IsEmail()
  email!: string;
}
