import { Link } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/misc';
import { PublicShell } from '@/components/layout/Shells';
import { Icon } from '@/components/ui/Icon';

export function NotFoundPage() {
  useDocumentTitle('页面不存在');
  return (
    <PublicShell>
      <div className="error-code">404</div>
      <h1 className="public-title">页面不存在</h1>
      <p className="public-lede">你访问的地址可能已经移动，或从未存在。</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link className="btn btn-primary" to="/">
          <Icon name="arrow-right" /> 返回工作台
        </Link>
        <Link className="btn" to="/messages">
          查看消息列表
        </Link>
      </div>
    </PublicShell>
  );
}