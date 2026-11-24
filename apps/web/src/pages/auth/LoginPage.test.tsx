import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '@/stores/auth';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', user: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks submission with an inline message when fields are empty', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByText('请输入用户名和密码')).toBeInTheDocument();
  });

  it('surfaces the backend error envelope message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, message: '用户名或密码错误', code: 'UNAUTHORIZED' }, 401),
      ),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'root' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByText('用户名或密码错误')).toBeInTheDocument());
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('enters the forced password-change state when the login result requires it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: {
            must_change_password: true,
            user: {
              id: 1,
              username: 'root',
              display_name: 'root',
              role: 'root',
              status: 'active',
              permissions: { send_email_to_others: true, save_message: true },
              must_change_password: true,
              deleted_at: null,
              created_at: '2026-11-01T00:00:00Z',
            },
          },
        }),
      ),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: 'root' } });
    fireEvent.change(screen.getByLabelText(/密码/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(useAuthStore.getState().status).toBe('must_change_password'));
  });
});
