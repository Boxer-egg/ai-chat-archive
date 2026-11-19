/** 归档页：会话列表 + 详情 + 搜索 + 导出/导入/清空 */
import { render, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../styles.css';
import { api } from '../api';
import { sanitizeHtml } from '../../core/sanitize';
import { exportFileName } from '../../core/export/filename';
import type { Account, Conversation, Message } from '../../core/types';
import type { SearchHitConversation } from '../../core/protocol';

const PLATFORM_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  kimi: 'Kimi',
  grok: 'Grok',
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 消息渲染（消毒后的 HTML，渲染前再清一次） ----------

function MessageBody({ html, text }: { html?: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html) {
      // 入库时已消毒；渲染前再过一遍白名单（纵深防御，技术方案 §10.3）
      ref.current.innerHTML = '';
      const tpl = document.createElement('template');
      tpl.innerHTML = sanitizeHtml(html);
      ref.current.appendChild(tpl.content.cloneNode(true));
    }
  }, [html]);
  if (!html) return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  return <div ref={ref} class="msg-body" />;
}

function RoleBadge({ role }: { role: string }) {
  const label = role === 'user' ? '用户' : role === 'assistant' ? '助手' : role;
  const color = role === 'user' ? 'var(--accent)' : '#16a34a';
  return (
    <span style={{ color, fontWeight: 600, marginRight: 8, fontSize: 12 }}>{label}</span>
  );
}

// ---------- 主组件 ----------

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platform, setPlatform] = useState('');
  const [accountKey, setAccountKey] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHitConversation[] | null>(null);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [convs, accs] = await Promise.all([
        api.listConversations(platform ? { platform } : accountKey ? { accountKey } : undefined),
        api.listAccounts(),
      ]);
      setConversations(convs as Conversation[]);
      setAccounts(accs as Account[]);
    } catch (err) {
      setNotice(`读取归档失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [platform, accountKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openConversation = async (id: string) => {
    setSelectedId(id);
    try {
      setDetail((await api.getMessages(id)) as { conversation: Conversation; messages: Message[] });
      setHits(null);
    } catch (err) {
      setNotice(`读取会话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doSearch = async () => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const res = (await api.search({
        query,
        platform: platform || undefined,
        accountKey: accountKey || undefined,
      })) as { hits: SearchHitConversation[]; total: number };
      setHits(res.hits);
    } catch (err) {
      setNotice(`搜索失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSearching(false);
    }
  };

  const doExportJson = async (conversationId?: string) => {
    try {
      const { backup } = (await api.exportJson(conversationId)) as { backup: unknown };
      download(
        exportFileName(
          conversationId ? detail?.conversation.title : undefined,
          new Date().toISOString().slice(0, 10),
          'json',
        ),
        JSON.stringify(backup, null, 2),
        'application/json',
      );
    } catch (err) {
      setNotice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doExportMarkdown = async (conversationId?: string) => {
    try {
      const { markdown } = (await api.exportMarkdown(conversationId)) as { markdown: string };
      download(
        exportFileName(
          conversationId ? detail?.conversation.title : undefined,
          new Date().toISOString().slice(0, 10),
          'md',
        ),
        markdown,
        'text/markdown',
      );
    } catch (err) {
      setNotice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const preview = (await api.importPreview(text)) as {
        plan: { conversations: number; messages: number; estimateBytes?: number };
      };
      const warn =
        (preview.plan.estimateBytes ?? 0) > 50 * 1024 * 1024
          ? '\n\n⚠️ 备份体积超过 50MB，导入可能较慢并占用大量内存，建议分平台导出后再导入。'
          : '';
      if (!confirm(`将导入 ${preview.plan.conversations} 个会话、${preview.plan.messages} 条消息。${warn}\n继续？`)) return;
      const result = (await api.importApply(text)) as { inserted: number; updated: number };
      setNotice(`导入完成：新增 ${result.inserted} 条，更新 ${result.updated} 条`);
      await reload();
    } catch (err) {
      setNotice(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doClear = async () => {
    if (!confirm('将删除全部本地归档（设置保留）。确定继续？')) return;
    if (!confirm('再次确认：删除后无法恢复，除非已导出备份。')) return;
    try {
      await api.clearAll();
      setSelectedId(null);
      setDetail(null);
      setNotice('已清空全部数据');
      await reload();
    } catch (err) {
      setNotice(`清空失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const list = useMemo(
    () =>
      (hits
        ? hits.map((x) => ({
            id: x.conversationId,
            title: x.title,
            platform: x.platform,
            accountLabel: x.accountLabel,
            messageCount: x.messages.length,
            updatedAt: x.updatedAt,
            url: x.url,
          }))
        : conversations) as Array<{
        id: string;
        title: string;
        platform: string;
        accountLabel: string;
        messageCount: number;
        updatedAt: number;
        url: string;
      }>,
    [hits, conversations],
  );

  const toolbar: ComponentChildren = (
    <div class="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder="搜索标题与消息内容…"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
        style={{ width: 220 }}
      />
      <button class="primary" onClick={doSearch} disabled={searching}>
        {searching ? '搜索中…' : '搜索'}
      </button>
      <select value={platform} onChange={(e) => setPlatform((e.target as HTMLSelectElement).value)}>
        <option value="">全部平台</option>
        {Object.entries(PLATFORM_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <select value={accountKey} onChange={(e) => setAccountKey((e.target as HTMLSelectElement).value)}>
        <option value="">全部账号</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.accountKey}>{a.label}</option>
        ))}
      </select>
      <span class="grow" />
      <button onClick={() => void doExportMarkdown()}>导出 Markdown</button>
      <button onClick={() => void doExportJson()}>导出备份</button>
      <button onClick={() => fileRef.current?.click()}>导入</button>
      <button class="danger" onClick={() => void doClear()}>清空</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void doImport(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header class="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
        <strong style={{ fontSize: 15 }}>AI 对话归档</strong>
        {toolbar}
      </header>
      {notice && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)' }} class="muted">
          {notice}
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 会话列表 */}
        <aside style={{ width: 320, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          {list.length === 0 && <div class="muted" style={{ padding: 16 }}>暂无归档</div>}
          {list.map((c) => (
            <div
              key={c.id}
              onClick={() => void openConversation(c.id)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                background: selectedId === c.id ? 'var(--chip)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title}
              </div>
              <div class="muted" style={{ fontSize: 12 }}>
                {PLATFORM_LABEL[c.platform] ?? c.platform} · {c.accountLabel} · {c.messageCount} 条 ·{' '}
                {fmtTime(c.updatedAt)}
              </div>
              {hits &&
                hits
                  .find((x) => x.conversationId === c.id)
                  ?.messages.map((m) => (
                    <div key={m.id} class="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      <RoleBadge role={m.role} />
                      {m.snippet}
                    </div>
                  ))}
            </div>
          ))}
        </aside>

        {/* 详情 */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          {!detail ? (
            <div class="muted" style={{ marginTop: 40, textAlign: 'center' }}>
              选择左侧会话查看详情
            </div>
          ) : (
            <>
              <div class="row" style={{ marginBottom: 12, gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 17 }} class="grow">
                  {detail.conversation.title}
                </h2>
                <button onClick={() => chrome.tabs.create({ url: detail.conversation.url })}>
                  打开原网页
                </button>
                <button onClick={() => void doExportMarkdown(detail.conversation.id)}>导出 MD</button>
                <button onClick={() => void doExportJson(detail.conversation.id)}>导出 JSON</button>
                <button
                  class="danger"
                  onClick={() => {
                    if (confirm('删除该会话的本地归档？')) {
                      void api
                        .deleteConversation(detail.conversation.id)
                        .then(() => {
                          setDetail(null);
                          setSelectedId(null);
                          void reload();
                        })
                        .catch((err: unknown) =>
                          setNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`),
                        );
                    }
                  }}
                >
                  删除
                </button>
              </div>
              <div class="muted" style={{ marginBottom: 16, fontSize: 12 }}>
                {PLATFORM_LABEL[detail.conversation.platform]} · {detail.conversation.accountLabel} ·{' '}
                {detail.messages.filter((m) => m.status === 'complete').length} 条 · 更新于{' '}
                {fmtTime(detail.conversation.updatedAt)}
              </div>
              {detail.messages
                .filter((m) => m.status === 'complete')
                .map((m) => (
                  <div key={m.id} style={{ marginBottom: 14 }}>
                    <div style={{ marginBottom: 4 }}>
                      <RoleBadge role={m.role} />
                      <span class="muted" style={{ fontSize: 11 }}>
                        {m.timestamp ? fmtTime(m.timestamp) : ''}
                      </span>
                    </div>
                    <MessageBody html={m.contentHtml} text={m.contentText} />
                  </div>
                ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

render(<App />, document.body);
