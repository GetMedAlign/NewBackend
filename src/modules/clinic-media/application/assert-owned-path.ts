import { ForbiddenException } from '@nestjs/common';

export function assertOwnedPath(path: string, expectedPrefix: string): void {
  const bad =
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
  if (bad || !path.startsWith(expectedPrefix)) {
    throw new ForbiddenException('Path does not belong to your clinic');
  }
}
