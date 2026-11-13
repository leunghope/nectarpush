import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import type { MeSecurityData } from '@nectarpush/shared';

/** Password / mailbox-verification / OAuth binding state for the settings page. */
export function useMeSecurity() {
  return useQuery({
    queryKey: ['me-security'],
    queryFn: () => call<MeSecurityData>(api.GET('/api/me/security')),
  });
}