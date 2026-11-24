import '@testing-library/jest-dom/vitest';

// jsdom runs on Node's undici primitives, where `new Request('/api/x')` throws
// ("Failed to parse URL") because relative URLs need a document base. Browsers
// accept them, so the app itself is fine — this only aligns the test runtime
// with browser behaviour. Stubs for `fetch` then receive a real Request object.
const NativeRequest = globalThis.Request;
if (NativeRequest) {
  class RelativeRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const absolute =
        typeof input === 'string' && input.startsWith('/')
          ? `http://localhost:3000${input}`
          : input;
      super(absolute as RequestInfo, init);
    }
  }
  globalThis.Request = RelativeRequest as unknown as typeof Request;
}
