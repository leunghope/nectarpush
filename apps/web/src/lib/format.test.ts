import { describe, expect, it } from 'vitest';
import { avatarInitial, MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE, ROLE_RANK, USER_ROLE_LABEL, formatDate, formatLatency } from './format';

describe('formatLatency', () => {
  it('renders sub-second values in ms', () => {
    expect(formatLatency(0)).toBe('0 ms');
    expect(formatLatency(12)).toBe('12 ms');
  });

  it('renders second-scale values with two decimals', () => {
    expect(formatLatency(1500)).toBe('1.50 s');
  });

  it('renders unknown latency as a dash', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(undefined)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO timestamp as YYYY-MM-DD HH:mm', () => {
    expect(formatDate('2026-11-02T10:00:00Z')).toMatch(/^2026-11-0\d \d{2}:\d{2}$/);
  });

  it('falls back to a dash for missing or invalid values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('avatarInitial', () => {
  it('keeps the first grapheme and uppercases Latin initials', () => {
    expect(avatarInitial('  hope ')).toBe('H');
    expect(avatarInitial('张三')).toBe('张');
    expect(avatarInitial('🍊orange')).toBe('🍊');
  });

  it('falls back to ? for missing names', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial(null)).toBe('?');
  });
});

describe('status and role vocabulary', () => {
  it('covers every message status with a label and a tone', () => {
    for (const status of ['pending', 'async_pending', 'success', 'partial', 'failed'] as const) {
      expect(MESSAGE_STATUS_LABEL[status]).toBeTruthy();
      expect(MESSAGE_STATUS_TONE[status]).toMatch(/^badge-/);
    }
    expect(MESSAGE_STATUS_LABEL.partial).toBe('部分成功');
  });

  it('orders roles user < admin < root', () => {
    expect(ROLE_RANK.user).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.root);
    expect(USER_ROLE_LABEL.root).toBe('超级管理员');
  });
});
