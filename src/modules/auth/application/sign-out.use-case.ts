import { Injectable } from '@nestjs/common';

export interface SignOutInput {
  userId?: string;
}

export interface SignOutOutput {
  ok: true;
}

@Injectable()
export class SignOutUseCase {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_input: SignOutInput): Promise<SignOutOutput> {
    // Stateless JWT — no server-side session to revoke.
    // Cookie clearing is handled by the HTTP layer (Task 8).
    return { ok: true };
  }
}
