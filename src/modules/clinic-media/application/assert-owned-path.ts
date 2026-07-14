import { ForbiddenException } from '@nestjs/common';

export function assertOwnedPath(path: string, expectedPrefix: string): void {
  if (!path.startsWith(expectedPrefix)) {
    throw new ForbiddenException(`Path does not belong to your clinic`);
  }
}
