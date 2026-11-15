import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { bootstrapAuth } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth';
import { Brand } from '@/components/ui/Brand';
import { Spinner } from '@/components/ui/Feedback';
import { ToastStack } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Modal';
import { AppShell } from '@/components/layout/AppShell';
import { SseProvider } from '@/components/layout/SseProvider';
import { useFavicon } from '@/hooks/branding';
import { RequireAuth, RequireRole } from '@/components/layout/guards';
import { ForcedPasswordChangePage } from '@/pages/auth/ForcedPasswordChangePage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ResetRequestPage } from '@/pages/auth/ResetRequestPage';
import { ResetConfirmPage } from '@/pages/auth/ResetConfirmPage';
import { OAuthCallbackPage } from '@/pages/auth/OAuthCallbackPage';
import { WorkbenchPage } from '@/pages/WorkbenchPage';
import { MessagesPage } from '@/pages/messages/MessagesPage';
import { MessageDetailPage } from '@/pages/messages/MessageDetailPage';
import { NewMessagePage } from '@/pages/messages/NewMessagePage';
import { PublicMessagePage } from '@/pages/PublicMessagePage';
import { ChannelsPage } from '@/pages/channels/ChannelsPage';
import { ChannelEditPage } from '@/pages/channels/ChannelEditPage';
import { WebhooksPage } from '@/pages/webhooks/WebhooksPage';
import { WebhookEditPage } from '@/pages/webhooks/WebhookEditPage';
import { MePage } from '@/pages/settings/MePage';
import { PushSettingsPage } from '@/pages/settings/PushSettingsPage';
import { SystemSettingsPage } from '@/pages/settings/SystemSettingsPage';
import { OtherSettingsPage } from '@/pages/settings/OtherSettingsPage';
import { UsersPage } from '@/pages/users/UsersPage';
import { UserEditPage } from '@/pages/users/UserEditPage';
import { AboutPage } from '@/pages/AboutPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function BootScreen() {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <Brand />
      <Spinner label="正在加载" />
    </div>
  );
}

export function App() {
  useFavicon();
  const status = useAuthStore((s) => s.status);
  const [, setBooted] = useState(false);

  useEffect(() => {
    bootstrapAuth().finally(() => setBooted(true));
  }, []);

  if (status === 'loading') return <BootScreen />;
  // Hard block: a password change is mandatory before anything else.
  if (status === 'must_change_password') return <ForcedPasswordChangePage />;

  return (
    <ConfirmProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/reset" element={<ResetRequestPage />} />
        <Route path="/reset-password" element={<ResetConfirmPage />} />
        <Route path="/reset/confirm" element={<ResetConfirmPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/message/:uuid" element={<PublicMessagePage />} />
        <Route path="/about" element={<AboutPage />} />

        <Route
          element={
            <RequireAuth>
              <SseProvider enabled>
                <AppShell />
              </SseProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<WorkbenchPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/new" element={<NewMessagePage />} />
          <Route path="/messages/:id" element={<MessageDetailPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/channels/new" element={<ChannelEditPage />} />
          <Route path="/channels/:id/edit" element={<ChannelEditPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/webhooks/new" element={<WebhookEditPage />} />
          <Route path="/webhooks/:id/edit" element={<WebhookEditPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/me/push" element={<PushSettingsPage />} />
          <Route
            path="/users"
            element={<RequireRole min="admin"><UsersPage /></RequireRole>}
          />
          <Route
            path="/users/new"
            element={<RequireRole min="admin"><UserEditPage /></RequireRole>}
          />
          <Route
            path="/users/:id/edit"
            element={<RequireRole min="admin"><UserEditPage /></RequireRole>}
          />
          <Route
            path="/settings"
            element={<RequireRole min="root"><SystemSettingsPage /></RequireRole>}
          />
          <Route
            path="/settings/other"
            element={<RequireRole min="root"><OtherSettingsPage /></RequireRole>}
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastStack />
    </ConfirmProvider>
  );
}
