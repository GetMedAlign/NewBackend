import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body of POST /admin/clinics/:id/notes (spec §1.6). */
export class AddNoteDto {
  @ApiProperty({ example: 'Called clinic to confirm license renewal.', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}
