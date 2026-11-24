import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { bootstrapAuth } from '@/lib/auth';
import { useDocumentTitle } from '@/hooks/misc';
import { AuthShell } from '@/components/layout/Shells';
import { Alert, Spinner } from '@/components/ui/Feedback';

export function OAuthCallbackPage() {
  useDocumentTitle('登录中');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const error = params.get('oauth_error') || params.get('error');
  const [failed, setFailed] = useState<string | null>(error);

  useEffect(() => {
    if (error) return;
    bootstrapAuth()
      .then(() => navigate('/', { replace: true }))
      .catch(() => setFailed('OAuth 登录失败，请重试。'));
  }, [error, navigate]);

  if (failed) {
    return (
      <AuthShell
        kicker="Auth / OAuth2"
        title="无法完成登录"
        footer={
          <>
            返回<Link to="/login">登录</Link>
          </>
        }
      >
        <Alert tone="error">{failed}</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Auth / OAuth2" title="正在完成登录" lede="通用 OAuth2 安全回调">
      <div className="center-state">
        <Spinner label="正在登录" />
      </div>
    </AuthShell>
  );
}
