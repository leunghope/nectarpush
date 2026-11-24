import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OAuth2CallbackBaseData } from '@nectarpush/shared';
import { OAuthProvidersForm } from './OAuthProvidersForm';

const servedBase: OAuth2CallbackBaseData = { base_url: 'https://push.example.com', source: 'server_address' };
const fallbackBase: OAuth2CallbackBaseData = { base_url: 'http://127.0.0.1:3000', source: 'fallback' };

function Harness({ initial, callbackBase = servedBase }: { initial: string; callbackBase?: OAuth2CallbackBaseData }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <OAuthProvidersForm value={value} onChange={setValue} callbackBase={callbackBase} />
      <output data-testid="json">{value}</output>
    </div>
  );
}

function json(): Record<string, unknown>[] {
  return JSON.parse(screen.getByTestId('json').textContent || '[]');
}

const configuredGithub =
  '[{"id":"github","display_name":"GitHub","enabled":true,"authorize_url":"https://github.com/login/oauth/authorize","token_url":"https://github.com/login/oauth/access_token","userinfo_url":"https://api.github.com/user","client_id":"cid","scope":"read:user user:email","map_username":"login","map_email":"email","has_secret":true}]';

const configuredCustom =
  '[{"id":"authentik","display_name":"公司 SSO","enabled":false,"discovery_url":"https://sso.example.com/.well-known/openid-configuration","client_id":"cid","scope":"openid profile email","map_username":"preferred_username","has_secret":true}]';

describe('OAuthProvidersForm', () => {
  it('renders one collapsible block per provider with its enable state', () => {
    render(<Harness initial={`[${configuredGithub.slice(1, -1)},${configuredCustom.slice(1, -1)}]`} />);
    expect(screen.getByText(/GitHub 登录 · 已配置/)).toBeInTheDocument();
    expect(screen.getByText(/自定义 OIDC · authentik · 已配置/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /GitHub启用/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /公司 SSO启用/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('collapsed blocks hide their fields; the header toggles the accordion', () => {
    render(<Harness initial={configuredGithub} />);
    // Configured providers start collapsed, so no Client ID input is rendered.
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
  });

  it('GitHub block only exposes name, Client ID and Client Secret', () => {
    render(<Harness initial={configuredGithub} />);
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    expect(screen.getByLabelText('显示名称')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    expect(screen.getByLabelText(/Client Secret/)).toBeInTheDocument();
    expect(screen.getByText('https://push.example.com/api/auth/oauth/github/callback')).toBeInTheDocument();
    expect(screen.queryByLabelText(/发现端点（OIDC）/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/authorize_url/)).not.toBeInTheDocument();
  });

  it('adds a GitHub provider from the preset and disables the button afterwards', () => {
    render(<Harness initial="[]" />);
    const add = screen.getByRole('button', { name: '添加 GitHub 登录' });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(json()[0]).toMatchObject({
      id: 'github',
      enabled: true,
      token_url: 'https://github.com/login/oauth/access_token',
    });
  });

  it('typing credentials serializes them; a blank secret keeps the stored one', () => {
    render(<Harness initial={configuredGithub} />);
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/Client Secret/), { target: { value: 'TOPSECRET' } });
    expect(json()[0].client_id).toBe('abc');
    expect(json()[0].client_secret).toBe('TOPSECRET');

    fireEvent.change(screen.getByLabelText(/Client Secret/), { target: { value: '' } });
    expect('client_secret' in json()[0]).toBe(false);
  });

  it('custom provider exposes an icon upload, Client ID, secret and discovery URL only', () => {
    render(<Harness initial="[]" />);
    fireEvent.click(screen.getByRole('button', { name: '添加自定义提供方' }));
    expect(screen.getByLabelText('显示名称')).toBeInTheDocument();
    expect(screen.getByLabelText(/发现端点（OIDC）/)).toBeInTheDocument();
    expect(screen.getByText('上传图标')).toBeInTheDocument();
    expect(screen.queryByLabelText(/authorize_url/)).not.toBeInTheDocument();
    expect(json()[0].id).toMatch(/^custom-/);
    expect(json()[0].discovery_url).toBe('');
  });

  it('shows the redirect URI built from the server base for every provider', () => {
    render(<Harness initial={`[${configuredGithub.slice(1, -1)},${configuredCustom.slice(1, -1)}]`} />);
    // GitHub 块与自定义 OIDC 块各自展开后都要给出自己的回调地址
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    expect(screen.getByText('https://push.example.com/api/auth/oauth/github/callback')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /自定义 OIDC · authentik · 已配置/ }));
    expect(screen.getByText('https://push.example.com/api/auth/oauth/authentik/callback')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制回调地址' })).toHaveLength(2);
  });

  it('warns when the base URL fell back to localhost', () => {
    render(<Harness initial={configuredGithub} callbackBase={fallbackBase} />);
    expect(screen.getByText(/服务端没能确定对外访问地址/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /GitHub 登录 · 已配置/ }));
    expect(screen.getByText('http://127.0.0.1:3000/api/auth/oauth/github/callback')).toBeInTheDocument();
  });

  it('toggling the enable switch writes enabled into the serialized value', () => {
    render(<Harness initial={configuredGithub} />);
    fireEvent.click(screen.getByRole('switch', { name: /GitHub启用/ }));
    expect(json()[0].enabled).toBe(false);
  });

  it('deleting a provider asks for confirmation first', () => {
    render(<Harness initial={configuredGithub} />);
    fireEvent.click(screen.getByRole('button', { name: '删除 GitHub' }));
    expect(screen.getByText('确定删除？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(json()).toEqual([]);
  });
});
