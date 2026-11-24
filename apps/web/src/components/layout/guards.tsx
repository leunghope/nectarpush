import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { ROLE_RANK } from '@/lib/format';
import type { UserRole } from '@nectarpush/shared';
import { Empty } from '@/components/ui/Feedback';

/** Redirect anonymous visitors to login, preserving the intended destination. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Render an inline "no permission" panel when the role is insufficient. */
export function RequireRole({ min, children }: { min: UserRole; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || ROLE_RANK[user.role] < ROLE_RANK[min]) {
    return (
      <Empty icon="shield" title="无权访问" description="当前账户没有访问该页面的权限，请联系管理员。" />
    );
  }
  return <>{children}</>;
}
