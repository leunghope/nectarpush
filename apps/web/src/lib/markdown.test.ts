import { describe, expect, it } from 'vitest';
import { renderContent } from './markdown';

describe('renderContent', () => {
  it('renders markdown links and text', () => {
    const html = renderContent('**hi** [link](https://example.com)', 'markdown');
    expect(html).toContain('<strong>hi</strong>');
    expect(html).toContain('href="https://example.com"');
  });

  it('never emits script tags from raw HTML in markdown mode', () => {
    const html = renderContent('<script>alert(1)</script>', 'markdown');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralises raw HTML tags (escaped, never rendered)', () => {
    const html = renderContent('<img src=x onerror=alert(1)>', 'markdown');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes plain text in code and raw modes', () => {
    const html = renderContent('a < b && c > d', 'raw');
    expect(html).toContain('raw-pre');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<b>');
  });

  it('returns an empty string for empty content', () => {
    expect(renderContent(null, 'markdown')).toBe('');
    expect(renderContent(undefined, 'markdown')).toBe('');
  });
});
