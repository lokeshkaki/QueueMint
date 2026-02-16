/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/services'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
      },
    }],
  },
  collectCoverageFrom: [
    'services/**/*.ts',
    '!services/**/*.test.ts',
    '!services/**/*.spec.ts',
    '!services/**/index.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  // Coverage thresholds temporarily set to 0 during initial setup
  // Will be increased as implementation progresses
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  coverageDirectory: '<rootDir>/coverage',
  moduleNameMapper: {
    '^@queuemint/shared/(.*)$': '<rootDir>/services/shared/src/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  testTimeout: 10000,
};
