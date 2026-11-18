// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureAdapter } from '../../src/content/adapters/__testing__/fixture';
import { makeCtx } from '../../src/content/adapters/base';
import { mergeSnapshot } from '@core/merge/merge-snapshot';
import { accountKeyFor } from '@core/account';
import { DEFAULT_ACCOUNT_KEY } from '../../src/shared/constants';

const FIX = (name: string) =>
  readFileSync(join(__dirname, 'fixtures/chatgpt', name), 'utf-8');

function loadDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function parseFixture(name: string, url = 'http://127.0.0.1:8787/chat/conv-1') {
  const doc = loadDoc(FIX(name));
  const ctx = makeCtx(url, doc);
  const nodes = fixtureAdapter.getMessageNodes(ctx);
  const raws = nodes
    .map((n) => fixtureAdapter.parseMessage(n, ctx))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return { ctx, nodes, raws, conv: fixtureAdapter.getConversation(ctx) };
}

describe('fixture 适配器解析', () => {
  it('new-3turns：会话 ID、标题、6 条消息、角色与代码缩进', () => {
    const { ctx, nodes, raws, conv } = parseFixture('new-3turns.html');
    expect(conv?.platformConversationId).toBe('conv-1');
    expect(fixtureAdapter.getTitle(ctx)).toBe('如何用 Python 读取 CSV');
    expect(nodes).toHaveLength(6);
    expect(raws).toHaveLength(6);
    expect(raws.filter((r) => r.role === 'user')).toHaveLength(3);
    expect(raws.filter((r) => r.role === 'assistant')).toHaveLength(3);
    expect(raws[1].text).toContain("df = pd.read_csv('a.csv')");
    expect(fixtureAdapter.isStreaming(ctx)).toBe(false);
    expect(fixtureAdapter.diagnose(ctx).status).toBe('ok');
  });

  it('账号识别：邮箱线索 + 脱敏（集成侧）', async () => {
    const { ctx } = parseFixture('new-3turns.html');
    const hint = fixtureAdapter.getAccountHint(ctx);
    expect(hint?.source).toBe('email');
    const key = hint ? await accountKeyFor('chatgpt', hint.rawId) : DEFAULT_ACCOUNT_KEY;
    expect(key).not.toBe(DEFAULT_ACCOUNT_KEY);
  });

  it('renamed：标题变化可被感知', () => {
    const { ctx } = parseFixture('renamed.html');
    expect(fixtureAdapter.getTitle(ctx)).toBe('Python 读取 CSV（已改名）');
  });

  it('long-70：70 条节点、含代码块、重复"继续"两条', () => {
    const { raws } = parseFixture('long-70.html');
    expect(raws).toHaveLength(70);
    const gos = raws.filter((r) => r.text === '继续');
    expect(gos).toHaveLength(2);
    expect(gos[0].domIndex).not.toBe(gos[1].domIndex);
  });

  it('消息节点缺失 → diagnose broken（U19）', () => {
    const doc = loadDoc('<html><body><p>没有消息</p></body></html>');
    const ctx = makeCtx('http://127.0.0.1:8787/chat/conv-1', doc);
    const d = fixtureAdapter.diagnose(ctx);
    expect(d.status).toBe('broken');
    expect(d.misses).toContain('message-node');
  });
});

describe('夹具 → merge 全链路', () => {
  it('验收 3：long-70 分两轮采集（先 20 后全量 70）顺序正确', async () => {
    const { raws } = parseFixture('long-70.html');
    const convId = 'chatgpt:default:conv-1';

    const first = await mergeSnapshot({
      conversationId: convId,
      existing: [],
      raws: raws.slice(50),
      now: 1000,
      adapterVersion: 'fixture-1.0',
    });
    expect(first.all).toHaveLength(20);

    const second = await mergeSnapshot({
      conversationId: convId,
      existing: first.all,
      raws: raws.map((r) => ({ ...r })),
      now: 2000,
      adapterVersion: 'fixture-1.0',
    });
    expect(second.inserted).toBe(50);
    expect(second.all).toHaveLength(70);
    expect(second.all.map((m) => m.contentText)).toEqual(raws.map((r) => r.text));
  });

  it('账号 A/B 同库不同桶（U21 集成侧）', async () => {
    const a = parseFixture('account-a.html');
    const b = parseFixture('account-b.html');
    const hintA = fixtureAdapter.getAccountHint(a.ctx)!;
    const hintB = fixtureAdapter.getAccountHint(b.ctx)!;
    const keyA = await accountKeyFor('chatgpt', hintA.rawId);
    const keyB = await accountKeyFor('chatgpt', hintB.rawId);
    expect(keyA).not.toBe(keyB);

    const convA = `chatgpt:${keyA}:conv-1`;
    const convB = `chatgpt:${keyB}:conv-1`;
    const outA = await mergeSnapshot({ conversationId: convA, existing: [], raws: a.raws, now: 1, adapterVersion: 't' });
    const outB = await mergeSnapshot({ conversationId: convB, existing: [], raws: b.raws, now: 2, adapterVersion: 't' });
    expect(outA.all[0].contentText).toBe('A 的问题');
    expect(outB.all[0].contentText).toBe('B 的问题');
  });
});
