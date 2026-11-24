import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@nectarpush/shared';

const NO_RETRY = new Set([400, 401, 403, 404, 409, 422, 429]);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof ApiError && NO_RETRY.has(err.status)) return false;
        return count < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
