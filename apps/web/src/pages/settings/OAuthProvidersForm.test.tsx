import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OAuthProvidersForm } from './OAuthProvidersForm';

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <OAuthProvidersForm value={value} onChange={setValue} />
      <output data-testid="json">{value}</output>
    </div>
  );
}

const redactedWithSecret =
  '[{"id":"authentik","display_name":"SSO","authorize_url":"https://a/authorize","token_url":"https://a/token","userinfo_url":"https://a/userinfo","client_id":"cid","scope":"openid","map_username":"sub","has_secret":true}]';

describe('OAuthProvidersForm (design §5)', () => {
  it('shows 已配置 badge when the provider has a stored secret', () => {
    render(<Harness initial={redactedWithSecret} />);
    expect(screen.getByText('已配置')).toBeInTheDocument();
  });

  it('shows 未配置 badge when no secret is stored', () => {
    render(
      <Harness
        initial={'[{"id":"x","authorize_url":"https://a","token_url":"https://t","userinfo_url":"https://u","client_id":"c","scope":"","map_username":"sub"}]'}
      />,
    );
    expect(screen.getByText('未配置')).toBeInTheDocument();
  });

  it('adds a GitHub provider from the preset and serializes it', () => {
    render(<Harness initial="[]" />);
    fireEvent.click(screen.getByRole('button', { name: '添加提供方' }));
    const authorize = screen.getByLabelText(/authorize_url/) as HTMLInputElement;
    expect(authorize.value).toBe('https://github.com/login/oauth/authorize');
    const json = JSON.parse(screen.getByTestId('json').textContent || '[]');
    expect(json[0].id).toBe('github');
    expect(json[0].token_url).toBe('https://github.com/login/oauth/access_token');
  });

  it('typing a secret serializes client_secret into the JSON', () => {
    render(<Harness initial="[]" />);
    fireEvent.click(screen.getByRole('button', { name: '添加提供方' }));
    fireEvent.change(screen.getByLabelText(/client_id/), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/client_secret/), { target: { value: 'TOPSECRET' } });
    const json = JSON.parse(screen.getByTestId('json').textContent || '[]');
    expect(json[0].client_id).toBe('abc');
    expect(json[0].client_secret).toBe('TOPSECRET');
  });

  it('leaving the secret blank omits client_secret from the serialized JSON', () => {
    render(<Harness initial={redactedWithSecret} />);
    // touch another field so serialization happens, but keep secret blank
    fireEvent.change(screen.getByLabelText(/scope/), { target: { value: 'openid email' } });
    const json = JSON.parse(screen.getByTestId('json').textContent || '[]');
    expect('client_secret' in json[0]).toBe(false);
    expect(json[0].scope).toBe('openid email');
  });
});
