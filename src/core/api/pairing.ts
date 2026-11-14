export interface PairingLink {
  server: string;
  code: string;
}

const codePattern = /^[A-Z0-9]{6}$/;

export function parsePairingLink(input: string): PairingLink {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('配对链接格式无效');
  }

  if (url.protocol !== 'voxchat:' || url.hostname !== 'pair' || url.username || url.password
    || url.pathname !== '' || url.hash) {
    throw new Error('配对链接格式无效');
  }

  const server = url.searchParams.get('server') ?? '';
  const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
  let origin: URL;
  try {
    origin = new URL(server);
  } catch {
    throw new Error('配对链接缺少有效的 DSH 地址');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('配对链接中的 DSH 地址无效');
  }
  const hostname = origin.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname)
    || ['[::1]', '0.0.0.0', '[::]'].includes(hostname)) {
    throw new Error('配对链接不能使用本机回环地址');
  }
  if (!codePattern.test(code)) throw new Error('配对码应为 6 位字母或数字');
  if (url.searchParams.getAll('server').length !== 1 || url.searchParams.getAll('code').length !== 1) {
    throw new Error('配对链接包含重复参数');
  }
  for (const key of url.searchParams.keys()) {
    if (key !== 'server' && key !== 'code') throw new Error('配对链接包含不支持的参数');
  }
  return {server: origin.origin, code};
}
