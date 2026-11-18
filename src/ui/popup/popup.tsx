/** 弹窗：本站状态 / 已存条数 / 开关 / 手动同步 / 打开归档页 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../styles.css';
import { api, currentTab, sendToTab } from '../api';
import { PROTOCOL, type ContentStatus, type Settings } from '../../core/protocol';

function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [status, setStatus] = useState<ContentStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const host = tab?.url ? new URL(tab.url).hostname : '';

  const refresh = async () => {
    const t = await currentTab();
    setTab(t);
    setSettings(await api.getSettings());
    if (t?.id !== undefined) {
      try {
        setStatus(await sendToTab<ContentStatus>(t.id, { type: PROTOCOL.GET_CONTENT_STATUS }));
      } catch {
        setStatus(null); // 内容脚本未注入（不支持站点 / 暂停注入）
      }
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggleAutoSave = async () => {
    if (!settings) return;
    const next = await api.setSettings({ autoSave: !settings.autoSave });
    setSettings(next);
  };

  const toggleSite = async () => {
    if (!settings || !host) return;
    const disabled = settings.disabledHosts.includes(host)
      ? settings.disabledHosts.filter((h) => h !== host)
      : [...settings.disabledHosts, host];
    const next = await api.setSettings({ disabledHosts: disabled });
    setSettings(next);
  };

  const manualSync = async () => {
    if (tab?.id === undefined) return;
    setBusy(true);
    try {
      const r = await sendToTab(tab.id, { type: PROTOCOL.FORCE_SYNC });
      const res = r as { inserted?: number; error?: string } | null;
      if (!res) setNotice('没有可保存的内容');
      else if (res.error) setNotice(`保存失败：${res.error}`);
      else setNotice(`已保存：新增 ${res.inserted ?? 0} 条`);
      await refresh();
    } catch (err) {
      setNotice(`同步失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const sitePaused = !!settings?.disabledHosts.includes(host);
  const globallyPaused = settings ? !settings.autoSave : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <strong>AI 对话本地归档</strong>
        <button onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') })}>
          归档页
        </button>
      </div>

      {!status ? (
        <div class="muted">
          {host
            ? `无法连接页面（${host}）。若是刚更新/重载过扩展，请刷新该网页后再试；该站点需为对话页（URL 含 /c/）。`
            : '当前页面不可归档'}
        </div>
      ) : (
        <>
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <span>{status.title ?? '未命名会话'}</span>
            <span class="muted">{status.accountLabel}</span>
          </div>
          <div class="muted">
            页面消息 {status.platformMessageCount} 条
            {status.lastSync
              ? 'error' in status.lastSync
                ? ` · 保存失败：${(status.lastSync as { error?: string }).error}`
                : ` · 已归档 ${status.lastSync.messageCount ?? 0} 条`
              : ' · 尚未同步'}
          </div>
          {status.health !== 'ok' && (
            <div style={{ color: 'var(--danger)' }}>
              {status.health === 'broken' ? '适配失败：可尝试手动同步，或等待适配更新' : '部分内容未能保存'}
            </div>
          )}
          <button class="primary" disabled={busy} onClick={manualSync}>
            同步当前会话全部已加载消息
          </button>
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

      <label class="row">
        <input type="checkbox" checked={!globallyPaused} onChange={toggleAutoSave} />
        自动保存
      </label>
      {host && (
        <label class="row">
          <input type="checkbox" checked={!sitePaused} onChange={toggleSite} />
          允许归档 {host}
        </label>
      )}
      {notice && <div class="muted">{notice}</div>}
      <div class="muted" style={{ fontSize: 12 }}>
        数据仅保存在本机浏览器中，请自行备份敏感内容。
      </div>
    </div>
  );
}

render(<App />, document.body);
