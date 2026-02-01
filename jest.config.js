/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/**/*.d.ts',
    '!src/generated/**',
    '!src/app/**', // API routes tested via integration tests
    '!src/lib/__mocks__/**', // Mocks don't need coverage
    '!src/lib/slack/client.ts', // External API wrapper
    '!src/lib/github/client.ts', // External API wrapper
  ],
  coverageThreshold: {
    // Core business logic must be tested to 80% per ENGINEERING_STANDARDS.md
    global: {
      branches: 60,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Individual file thresholds for critical modules
    './src/lib/github/parser.ts': {
      branches: 80,
      functions: 100,
      lines: 95,
      statements: 95,
    },
    './src/lib/achievements/definitions.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};

module.exports = config;
