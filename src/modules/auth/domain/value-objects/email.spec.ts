import { Email } from './email';

describe('Email value object', () => {
  describe('valid emails', () => {
    it('accepts a simple valid email', () => {
      const email = Email.create('user@example.com');
      expect(email.toString()).toBe('user@example.com');
    });

    it('lowercases the email', () => {
      const email = Email.create('User@Example.COM');
      expect(email.toString()).toBe('user@example.com');
    });

    it('trims surrounding whitespace', () => {
      const email = Email.create('  user@example.com  ');
      expect(email.toString()).toBe('user@example.com');
    });

    it('lowercases and trims together', () => {
      const email = Email.create('  User@EXAMPLE.com  ');
      expect(email.toString()).toBe('user@example.com');
    });
  });

  describe('invalid emails', () => {
    it('throws on missing @', () => {
      expect(() => Email.create('notanemail')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => Email.create('')).toThrow();
    });

    it('throws on whitespace-only string', () => {
      expect(() => Email.create('   ')).toThrow();
    });

    it('throws on missing domain', () => {
      expect(() => Email.create('user@')).toThrow();
    });

    it('throws on missing local part', () => {
      expect(() => Email.create('@example.com')).toThrow();
    });
  });
});
