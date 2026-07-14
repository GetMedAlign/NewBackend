import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ConfirmPhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  paths!: string[];
}
