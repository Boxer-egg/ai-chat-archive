/**
 * 导出文件名（借鉴 pionxzh 的文件名模板思路，先支持标题 + 日期）：
 * 清洗非法字符、限长、空标题回退，避免多会话导出互相覆盖。
 */
export function sanitizeFileName(name: string, maxLen = 60): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*-]/g, '') // 控制字符
    .replace(/[<>:"/\\|?*]/g, '') // 各系统非法字符
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, ''); // 首尾点/空格（Windows 文件名不允许尾点）
  if (!cleaned) return 'untitled';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trimEnd() : cleaned;
}

/** 单会话导出：<标题>-<日期>.<ext>；全部导出：ai-chat-archive-<日期>.<ext> */
export function exportFileName(
  title: string | undefined,
  date: string,
  ext: 'md' | 'json',
): string {
  const t = title?.trim();
  return t ? `${sanitizeFileName(t)}-${date}.${ext}` : `ai-chat-archive-${date}.${ext}`;
}
