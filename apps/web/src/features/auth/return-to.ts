export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://ryadom.invalid');
    if (url.origin !== 'https://ryadom.invalid') return '/';
    if (/^\/(?:login|register)(?:\/|$)/i.test(url.pathname) || /^\/(?:api|dev)(?:\/|$)/i.test(url.pathname)) return '/';
    // Reject encoded separators/control characters as well as dot-segment redirects.
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith('//') || decoded !== url.pathname && decoded.includes('/../')) return '/';
    if (/^\/(?:login|register|api|dev)(?:\/|$)/i.test(decoded)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

export function authLink(path: '/login' | '/register', returnTo: string) {
  const target = safeReturnTo(returnTo);
  return target === '/' ? path : `${path}?${new URLSearchParams({ returnTo: target })}`;
}
