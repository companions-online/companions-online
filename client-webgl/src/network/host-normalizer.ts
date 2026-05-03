// Normalize a free-form host string (entered on the menu's create-join
// "Remote Host" field) to a complete WebSocket URL the server expects.
//
// Accepts:
//   * bare hostnames           → wss://host/ws  (or ws:// for local)
//   * https://host             → wss://host/ws
//   * http://host              → ws://host/ws    (preserves insecure choice)
//   * ws://host  / wss://host  → preserved
//   * host:port                → scheme + port + /ws
//   * full URLs with paths     → preserved literally (no /ws appended)
//
// Rejects: empty input, whitespace inside, syntactically invalid URL.
//
// Local-host heuristic: localhost / 127.x.x.x / ::1 / *.local default
// to ws:// (most dev servers don't have valid TLS); other hosts default
// to wss://. An explicit scheme always wins.

export type NormalizeResult = { url: string } | { error: string };

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|::1|[\w-]+\.local)$/i;

export function normalizeHost(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed === '') return { error: 'host is empty' };
  if (/\s/.test(trimmed)) return { error: 'host contains whitespace' };

  const hadScheme = /^[a-z]+:\/\//i.test(trimmed);
  // URL constructor needs a scheme to parse — add a placeholder when the
  // user typed bare "host" or "host:port". The scheme we add doesn't
  // matter; we override it below based on the local-host heuristic.
  const withScheme = hadScheme ? trimmed : 'https://' + trimmed;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: 'invalid host syntax' };
  }

  const hostname = parsed.hostname;
  if (!hostname) return { error: 'host has no hostname' };

  // Determine secure vs insecure. Explicit scheme wins; otherwise the
  // local-host heuristic decides.
  let secure: boolean;
  if (hadScheme) {
    if (parsed.protocol === 'ws:' || parsed.protocol === 'http:') secure = false;
    else if (parsed.protocol === 'wss:' || parsed.protocol === 'https:') secure = true;
    else return { error: `unsupported scheme: ${parsed.protocol}` };
  } else {
    secure = !LOCAL_HOST_RE.test(hostname);
  }

  const scheme = secure ? 'wss' : 'ws';
  const port = parsed.port ? ':' + parsed.port : '';
  // Preserve user's explicit path; default to /ws when none was given.
  // URL parses missing/empty path as '/' — treat that as "no path".
  const rawPath = parsed.pathname;
  const path = (rawPath && rawPath !== '/') ? rawPath : '/ws';

  return { url: `${scheme}://${hostname}${port}${path}` };
}
