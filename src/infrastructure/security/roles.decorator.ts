import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Restricts a route/handler to the given roles (checked by RolesGuard). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
