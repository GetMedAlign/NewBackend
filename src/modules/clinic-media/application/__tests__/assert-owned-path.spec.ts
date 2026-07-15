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

  // Traversal-safety negative cases — must throw even though the path starts with the expected prefix
  it('throws ForbiddenException for a path-traversal escape via ..', () => {
    expect(() => assertOwnedPath('photos/clinicA/../clinicB/x.png', 'photos/clinicA/')).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for a nested path-traversal escape via ..', () => {
    expect(() =>
      assertOwnedPath('photos/clinicA/x/../../clinicB/y.png', 'photos/clinicA/'),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for a leading-slash path', () => {
    expect(() => assertOwnedPath('/photos/clinicA/x', 'photos/clinicA/')).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for a backslash path', () => {
    expect(() => assertOwnedPath('photos/clinicA\\x', 'photos/clinicA/')).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for a double-slash path', () => {
    expect(() => assertOwnedPath('photos/clinicA//x', 'photos/clinicA/')).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for a dot-segment path', () => {
    expect(() => assertOwnedPath('photos/clinicA/./x.png', 'photos/clinicA/')).toThrow(
      ForbiddenException,
    );
  });
});
