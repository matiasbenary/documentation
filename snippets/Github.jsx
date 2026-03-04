
function toRaw(ref) {
  const fullUrl = ref.slice(ref.indexOf('https'));
  const [url] = fullUrl.split('#');
  const [org, repo, , branch, ...pathSeg] = new URL(url).pathname.split('/').slice(1);
  return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathSeg.join('/')}`;
}

async function fetchCode(url, fromLine, toLine) {
  let res;

  if (typeof window !== 'undefined') {
    const validUntil = localStorage.getItem(`${url}-until`);
    if (validUntil && Number(validUntil) > Date.now()) {
      res = localStorage.getItem(url);
    }
  }

  if (!res) {
    try {
      res = await (await fetch(url)).text();
      if (typeof window !== 'undefined') {
        localStorage.setItem(url, res);
        localStorage.setItem(`${url}-until`, String(Date.now() + 60000));
      }
    } catch {
      return 'Error fetching code, please try reloading';
    }
  }

  let body = res.split('\n');
  const from = fromLine ? Number(fromLine) - 1 : 0;
  const to = toLine ? Number(toLine) : body.length;
  body = body.slice(from, to);

  const precedingSpace = body.reduce((prev, line) => {
    if (line.length === 0) return prev;
    const spaces = line.match(/^\s+/);
    if (spaces) return Math.min(prev, spaces[0].length);
    return 0;
  }, Infinity);

  return body.map((line) => line.slice(precedingSpace === Infinity ? 0 : precedingSpace)).join('\n');
}

function buildSourceUrl(url, start, end) {
  const base = url.split('#')[0];
  if (start && end) return `${base}#L${start}-L${end}`;
  if (start) return `${base}#L${start}`;
  return base;
}

export function Github({ url, start, end, language = 'text', fname, withSourceLink = true }) {
  const [code, setCode] = useState(null);

  useEffect(() => {
    const rawUrl = toRaw(url);
    fetchCode(rawUrl, start, end).then((res) => setCode(res));
  }, [url, start, end]);

  const sourceUrl = buildSourceUrl(url, start, end);
  const startLine = start ? Number(start) : 1;

  return (
    <div style={{
      borderRadius: '0.75rem',
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
      margin: '1rem 0',
      fontSize: '0.875rem',
      fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        background: '#f3f4f6',
        borderBottom: '1px solid #e5e7eb',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#6b7280">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span style={{ fontSize: '0.75rem', color: '#374151' }}>
            {fname ?? sourceUrl.split('/').pop()}
          </span>
        </div>
        {start && end && (
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            Lines {start}–{end}
          </span>
        )}
      </div>

      {/* Code */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '460px', background: '#0d1117' }}>
        {code === null ? (
          <div style={{ padding: '1rem', color: '#9ca3af', fontSize: '0.75rem' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {code.split('\n').map((line, i) => (
                <tr key={i}>
                  <td style={{
                    userSelect: 'none',
                    paddingLeft: '1rem',
                    paddingRight: '0.75rem',
                    textAlign: 'right',
                    color: '#4b5563',
                    fontSize: '0.75rem',
                    width: '2rem',
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                  }}>
                    {startLine + i}
                  </td>
                  <td style={{
                    paddingRight: '1rem',
                    fontSize: '0.75rem',
                    color: '#e5e7eb',
                    whiteSpace: 'pre',
                  }}>
                    {line || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {withSourceLink && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '0.5rem',
          background: '#161b22',
          borderTop: '1px solid #30363d',
        }}>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#60a5fa',
              textDecoration: 'underline',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            See full example on GitHub
          </a>
        </div>
      )}
    </div>
  );
}

export default Github;
