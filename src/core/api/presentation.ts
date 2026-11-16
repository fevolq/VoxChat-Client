import type {HistoryItem, Session} from './types';

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (row.type === 'text' && typeof row.text === 'string') return row.text;
    if (row.content !== undefined) return contentText(row.content);
  }
  return '';
}
export function historyRows(items: HistoryItem[]): {key: string; role: string; text: string}[] {
  return items.flatMap((item, i) => {
    const data = (item.data ?? {}) as Record<string, unknown>;
    const type = String(item.type ?? '');
    let role = '', text = '';
    if (type === 'user/message') { role = '你'; text = contentText(data.message ?? data.content ?? data.text); }
    if (type === 'assistant/message') { role = '助手'; text = contentText(data.message ?? data.content); }
    if (type === 'tool/call') { role = '工具'; text = String(data.name ?? (data.call as Record<string, unknown> | undefined)?.name ?? '正在调用工具'); }
    return text ? [{key: String(item.seq ?? i), role, text}] : [];
  });
}
export function sessionTitle(session: Session): string {
  const projections = session.projections as Record<string, unknown> | undefined;
  const values = (projections?.values ?? projections) as Record<string, unknown> | undefined;
  const title = values?.title;
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object' && typeof (title as Record<string, unknown>).title === 'string') return String((title as Record<string, unknown>).title);
  return '';
}
