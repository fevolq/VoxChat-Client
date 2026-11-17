import type {HistoryItem, Session} from './types';

export function contentText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}
export function historyRows(items: HistoryItem[]): {key: string; role: string; text: string}[] {
  return items.flatMap(item => {
    const {data, type} = item;
    let role = '', text = '';
    if (type === 'user/message') { role = '你'; text = contentText(data.content); }
    if (type === 'assistant/message') { role = '助手'; text = contentText((data.message as {content?: unknown} | undefined)?.content); }
    if (type === 'tool/call') { role = '工具'; text = typeof data.name === 'string' ? data.name : ''; }
    return text ? [{key: String(item.seq), role, text}] : [];
  });
}
export function sessionTitle(session: Session): string {
  return session.projections?.values.title ?? '';
}
