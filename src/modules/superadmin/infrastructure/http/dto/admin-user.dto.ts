import { ApiProperty } from '@nestjs/swagger';

export class AdminUserDto {
  @ApiProperty({ description: 'User UUID' })
  id!: string;

  @ApiProperty({ description: "Admin's full name", example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ description: 'Email address', example: 'jane@medalign.example.com' })
  email!: string;

  @ApiProperty({ description: 'Role', enum: ['admin', 'superadmin'], example: 'admin' })
  role!: 'admin' | 'superadmin';

  @ApiProperty({ description: 'Account creation timestamp (ISO 8601)' })
  createdAt!: string;
}
