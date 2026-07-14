import { ForbiddenException } from '@nestjs/common';
import { assertOwnedPath } from '../assert-owned-path';

describe('assertOwnedPath', () => {
  it('throws ForbiddenException when path does not start with expectedPrefix', () => {
    expect(() => assertOwnedPath('logos/other-clinic/file.png', 'logos/my-clinic/')).toThrow(
      ForbiddenException,
    );
  });

  it('does not throw when path starts with expectedPrefix', () => {
    expect(() => assertOwnedPath('logos/my-clinic/file.png', 'logos/my-clinic/')).not.toThrow();
  });

  it('throws ForbiddenException for empty path', () => {
    expect(() => assertOwnedPath('', 'logos/my-clinic/')).toThrow(ForbiddenException);
  });
});
