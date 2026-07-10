import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  setupFiles: ['./test/setup-env.ts'],
  // Integration suites share a single Postgres database and seed/truncate their
  // own fixtures, so they must run serially to avoid cross-worker interference.
  maxWorkers: 1,
};

export default config;
