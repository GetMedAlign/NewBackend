import { IsInt, Max, Min } from 'class-validator';

export class SignPhotoUploadsDto {
  @IsInt()
  @Min(1)
  @Max(8)
  count!: number;
}
