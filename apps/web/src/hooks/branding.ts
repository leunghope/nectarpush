import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/api/client';
import type { BrandingData } from '@nectarpush/shared';

/** 后端未配置时与 DEFAULT_OPTIONS 保持一致，避免首屏闪成空字符串。 */
export const DEFAULT_BRANDING: BrandingData = {
  site_name: '蜂鸟推送',
  site_name_en: 'NectarPush',
  icon: '',
};

/** 站点品牌（名称/英文名/图标）来自公开端点，登录页也能拿到。 */
export function useBranding(): BrandingData {
  const { data } = useQuery({
    queryKey: ['public-branding'],
    queryFn: () => call<BrandingData>(api.GET('/api/public/branding')),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? DEFAULT_BRANDING;
}

/** 把站点图标同步为浏览器标签页图标；未配置时保留 index.html 的默认图标。 */
export function useFavicon(): void {
  const brand = useBranding();
  const fallback = useRef<string | null>(null);
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (fallback.current === null) fallback.current = link.getAttribute('href') ?? '';
    // 未配置站点图标时回到 index.html 的默认图标（保存清空后也要能还原）。
    link.href = brand.icon || fallback.current;
  }, [brand.icon]);
}
