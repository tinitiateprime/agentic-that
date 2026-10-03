export function telegramProxyHeaders(request: Request, publicUrl = process.env.PLATFORM_PUBLIC_URL) {
  const headers = new Headers(request.headers);
  // Amplify's request URL can point to the internal SSR server. Resolve the
  // external origin from the trusted deployment URL, not an arbitrary Origin.
  if (publicUrl?.trim()) {
    const origin = new URL(publicUrl.trim());
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      throw new Error('PLATFORM_PUBLIC_URL must be an HTTP(S) URL without credentials.');
    }
    // Both AgenticThat domains serve this application. Accept only that
    // explicit alias pair; custom deployments retain their exact configured
    // origin, and forged forwarded headers cannot add another trusted site.
    const publicHosts = new Set([origin.host]);
    if (origin.hostname === 'agenticthat.com' || origin.hostname === 'www.agenticthat.com') {
      const port = origin.port ? ':' + origin.port : '';
      publicHosts.add('agenticthat.com' + port);
      publicHosts.add('www.agenticthat.com' + port);
    }
    const browserOrigin = headers.get('origin');
    const matchedHost = [...publicHosts].find(host => browserOrigin === origin.protocol + '//' + host);
    headers.set('x-forwarded-host', matchedHost || origin.host);
    headers.set('x-forwarded-proto', origin.protocol.slice(0, -1));
  } else {
    const incoming = new URL(request.url);
    // Preserve the reverse proxy's external host when a standalone/local
    // deployment does not configure a canonical public URL.
    headers.set('x-forwarded-host', headers.get('x-forwarded-host')?.split(',')[0]?.trim()
      || headers.get('host') || incoming.host);
    headers.set('x-forwarded-proto', headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      || incoming.protocol.slice(0, -1));
  }
  return headers;
}
