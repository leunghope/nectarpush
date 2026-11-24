import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { RenderMode } from '@nectarpush/shared';

const md = new MarkdownIt({
  html: false, // never trust raw HTML from message bodies
  linkify: true,
  breaks: true,
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render message content to sanitized HTML according to its render mode. */
export function renderContent(content: string | null | undefined, mode: RenderMode = 'markdown'): string {
  if (!content) return '';
  if (mode === 'markdown') {
    return DOMPurify.sanitize(md.render(content), { USE_PROFILES: { html: true } });
  }
  const escaped = escapeHtml(content);
  return DOMPurify.sanitize(`<pre class="raw-pre"><code>${escaped}</code></pre>`, {
    USE_PROFILES: { html: true },
  });
}
