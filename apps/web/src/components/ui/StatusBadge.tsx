import { Badge } from './Field';
import { MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE, USER_ROLE_LABEL, USER_STATUS_LABEL } from '@/lib/format';
import type { MessageStatus, UserRole, UserStatus } from '@nectarpush/shared';

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge tone={MESSAGE_STATUS_TONE[status]}>{MESSAGE_STATUS_LABEL[status]}</Badge>;
}

export function UserRoleBadge({ role }: { role: UserRole }) {
  const tone = role === 'root' ? 'badge-info' : role === 'admin' ? 'badge-success' : 'badge-neutral';
  return (
    <Badge tone={tone} dot={false}>
      {USER_ROLE_LABEL[role]}
    </Badge>
  );
}

export function UserStatusBadge({ status, deleted }: { status: UserStatus; deleted?: boolean }) {
  if (deleted) return <Badge tone="badge-danger">已注销</Badge>;
  return <Badge tone={status === 'active' ? 'badge-success' : 'badge-warning'}>{USER_STATUS_LABEL[status]}</Badge>;
}

export function ChannelEnabledBadge({ enabled }: { enabled: boolean }) {
  return <Badge tone={enabled ? 'badge-success' : 'badge-neutral'}>{enabled ? '已启用' : '已停用'}</Badge>;
}
