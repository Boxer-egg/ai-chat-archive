import { describe, expect, it } from 'vitest';
import { accountKeyFor, maskLabel } from '@core/account';

describe('accountKeyFor', () => {
  it('同一平台同一账号 → 稳定 key；跨平台不同（U21 基础）', async () => {
    const a1 = await accountKeyFor('chatgpt', 'alice@example.com');
    const a2 = await accountKeyFor('chatgpt', 'alice@example.com');
    const b = await accountKeyFor('claude', 'alice@example.com');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('maskLabel（脱敏）', () => {
  it('邮箱：保留首字符与域名', () => {
    expect(maskLabel({ rawId: 'x', label: 'alice@example.com', source: 'email' })).toBe(
      'a***@example.com',
    );
  });
  it('手机号：前 3 后 4', () => {
    expect(maskLabel({ rawId: 'x', label: '13812345678', source: 'dom-id' })).toBe('138****5678');
  });
  it('工作区：原样', () => {
    expect(maskLabel({ rawId: 'x', label: '研发团队', source: 'workspace' })).toBe('研发团队');
  });
  it('昵称：保留首尾', () => {
    expect(maskLabel({ rawId: 'x', label: '张三丰', source: 'avatar' })).toBe('张*丰');
  });
});
