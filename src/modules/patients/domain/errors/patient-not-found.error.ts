export class PatientNotFoundError extends Error {
  constructor() {
    super('Account not found.');
    this.name = 'PatientNotFoundError';
  }
}
