/**
 * Jest Setup
 *
 * Global test configuration and mocks.
 */

// Set test environment variables
// Note: NODE_ENV is set via jest.config.js testEnvironment
Object.assign(process.env, {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  GITHUB_TOKEN: 'ghp_test_token',
});

// Increase timeout for async tests
jest.setTimeout(10000);

// Global mock for console.error to reduce test noise
// but still catch important errors
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Suppress expected test errors
    const message = args[0];
    if (typeof message === 'string' && message.includes('test')) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});
