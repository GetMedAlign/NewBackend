export class Patient {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly zipCode: string | null,
    public readonly dateOfBirth: Date | null,
    public readonly isDeleted: boolean,
  ) {}
}
