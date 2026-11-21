import { AiUrlSourceService } from './ai-url-source.service';
import { Agent } from 'undici';

jest.mock('undici', () => ({
  Agent: jest.fn().mockImplementation((options) => ({
    options,
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

import { lookup } from 'node:dns/promises';

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

function htmlResponse(
  html: string,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(html, {
    status: init.status ?? 200,
    headers: {
      'content-type': init.contentType ?? 'text/html; charset=utf-8',
    },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

describe('AiUrlSourceService', () => {
  let service: AiUrlSourceService;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    service = new AiUrlSourceService();
    (Agent as jest.MockedClass<typeof Agent>).mockClear();
    fetchMock = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    mockedLookup.mockReset();
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('extractUrls', () => {
    it('extracts http(s) URLs and trims trailing prose punctuation', () => {
      const urls = service.extractUrls(
        'Summarize https://example.com/post. Also see (https://example.org/a) and https://example.net/x, ok?',
      );

      expect(urls).toEqual([
        'https://example.com/post',
        'https://example.org/a',
        'https://example.net/x',
      ]);
    });

    it('deduplicates URLs and keeps the request bounded', () => {
      const urls = service.extractUrls(
        Array(10).fill('https://example.com/same').join(' and '),
      );

      expect(urls).toEqual(['https://example.com/same']);
    });

    it('preserves balanced parentheses and IPv6 brackets in explicit URLs', () => {
      expect(
        service.extractUrls(
          'Read (https://example.com/wiki/Topic_(detail)) and https://[2606:4700:4700::1111]/docs.',
        ),
      ).toEqual([
        'https://example.com/wiki/Topic_(detail)',
        'https://[2606:4700:4700::1111]/docs',
      ]);
    });

    it('limits distinct sources to four', () => {
      expect(
        service.extractUrls(
          Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`).join(
            ' ',
          ),
        ),
      ).toHaveLength(4);
    });

    it('ignores non-http schemes and returns nothing for plain text', () => {
      expect(service.extractUrls('no links here at all')).toEqual([]);
      expect(service.extractUrls(undefined)).toEqual([]);
      expect(
        service.extractUrls('open file:///etc/passwd ftp://example.com'),
      ).toEqual([]);
    });
  });

  describe('address safety', () => {
    const blockedHosts = [
      'http://127.0.0.1/secrets',
      'http://localhost:3000/admin',
      'http://10.1.2.3/internal',
      'http://192.168.0.7/internal',
      'http://172.16.5.5/internal',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/internal',
      'http://[::1]/internal',
      'http://[fd00::1234]/internal',
      'http://[fe80::1]/internal',
      'http://[fec0::1]/internal',
      'http://[64:ff9b::a00:1]/internal',
      'http://[2002:a00:1::1]/internal',
      'http://[::127.0.0.1]/internal',
      'http://[::ffff:127.0.0.1]/internal',
    ];

    it.each(blockedHosts)(
      'refuses to fetch %s without any network call',
      async (url) => {
        const [source] = await service.retrieve([url]);

        expect(source.status).toBe('error');
        expect(source.error).toMatch(
          /private or reserved|loopback hostname|could not be resolved/,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('refuses DNS answers containing any private address', async () => {
      mockedLookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ] as any);

      const [source] = await service.retrieve(['http://rebind.example/']);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/private or reserved/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses URLs with embedded credentials', async () => {
      const [source] = await service.retrieve([
        'https://user:***@example.com/file',
      ]);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/credentials/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('connection-time DNS pinning', () => {
    it('connects only to the validated DNS answers without a second lookup', async () => {
      const checked = [{ address: '93.184.216.34', family: 4 }];
      mockedLookup.mockResolvedValueOnce(checked as any);
      // A second DNS lookup could return a private address. The transport
      // lookup must use the checked addresses even if the resolver changes.
      mockedLookup.mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ] as any);
      fetchMock.mockImplementationOnce(async (_url, init) => {
        const dispatcher = (init as any).dispatcher;
        const all = jest.fn();
        dispatcher.options.connect.lookup('example.com', { all: true }, all);
        expect(all).toHaveBeenCalledWith(null, checked);
        const single = jest.fn();
        dispatcher.options.connect.lookup('example.com', { family: 4 }, single);
        expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
        return htmlResponse('<p>Public content</p>');
      });

      const [source] = await service.retrieve(['https://example.com/page']);
      expect(source.status).toBe('ok');
      expect(mockedLookup).toHaveBeenCalledTimes(1);
      expect(
        (fetchMock.mock.calls[0][1] as any).dispatcher.destroy,
      ).toHaveBeenCalledTimes(1);
    });

    it('validates the redirect hostname before a second connection', async () => {
      mockedLookup
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any)
        .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as any);
      fetchMock.mockResolvedValueOnce(
        redirectResponse('https://private.example/page'),
      );
      const [source] = await service.retrieve(['https://public.example/page']);
      expect(source.status).toBe('error');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        (fetchMock.mock.calls[0][1] as any).dispatcher.destroy,
      ).toHaveBeenCalledTimes(1);
    });

    it('rejects GitHub credentials before rewriting the URL', async () => {
      const [source] = await service.retrieve([
        'https://user:password@github.com/example/project/blob/main/README.md',
      ]);
      expect(source.status).toBe('error');
      expect(source.error).toMatch(/credentials/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('redirects', () => {
    it('follows redirects to public hosts and reports the final URL', async () => {
      fetchMock
        .mockResolvedValueOnce(redirectResponse('https://cdn.example/final'))
        .mockResolvedValueOnce(
          htmlResponse('<html><body><p>moved</p></body></html>'),
        )
        .mockResolvedValueOnce(undefined as any);
      mockedLookup
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any)
        .mockResolvedValueOnce([
          { address: '93.184.216.99', family: 4 },
        ] as any);

      const [source] = await service.retrieve(['http://short.example/go']);

      expect(source.status).toBe('ok');
      expect(source.finalUrl).toBe('https://cdn.example/final');
      expect(source.text).toContain('moved');
    });

    it('refuses a redirect that points at a private address', async () => {
      fetchMock.mockResolvedValueOnce(
        redirectResponse('http://169.254.169.254/latest/meta-data/'),
      );

      const [source] = await service.retrieve(['http://short.example/go']);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/private or reserved/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops after too many redirects', async () => {
      for (let i = 0; i < 10; i += 1) {
        fetchMock.mockResolvedValueOnce(
          redirectResponse(`http://a.example/r${i}`),
        );
      }

      const [source] = await service.retrieve(['http://a.example/start']);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/too many redirects/);
    });
  });

  describe('content retrieval', () => {
    it('converts public GitHub blob links to raw.githubusercontent.com', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('# WrenLore\n\nA wiki.', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      );

      const [source] = await service.retrieve([
        'https://github.com/wrenlore/wrenlore/blob/master/README.md',
      ]);

      expect(source.status).toBe('ok');
      const requestedUrl = fetchMock.mock.calls[0][0] as unknown as string;
      expect(requestedUrl).toBe(
        'https://raw.githubusercontent.com/wrenlore/wrenlore/master/README.md',
      );
      expect(source.text).toContain('A wiki.');
    });

    it('extracts readable text from HTML and drops scripts and chrome', async () => {
      fetchMock.mockResolvedValueOnce(
        htmlResponse(
          '<html><head><title>My Page</title><script>var secret=1;</script>' +
            '<style>body{color:red}</style></head>' +
            '<body><nav>Menu Item</nav><article><h1>Heading</h1>' +
            '<p>Useful paragraph.</p></article><footer>Copyright</footer></body></html>',
        ),
      );

      const [source] = await service.retrieve(['https://example.com/page']);

      expect(source.status).toBe('ok');
      expect(source.title).toBe('My Page');
      expect(source.text).toContain('Useful paragraph.');
      expect(source.text).toContain('Heading');
      expect(source.text).not.toContain('secret');
      expect(source.text).not.toContain('color:red');
      expect(source.text).not.toContain('Menu Item');
    });

    it('passes plain text and markdown through unchanged', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('# Title\n\n- fact one', {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        }),
      );

      const [source] = await service.retrieve(['https://example.com/doc.md']);

      expect(source.status).toBe('ok');
      expect(source.text).toBe('# Title\n\n- fact one');
    });

    it('rejects unsupported content types without reading the body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          headers: { 'content-type': 'image/png' },
        }),
      );

      const [source] = await service.retrieve(['https://example.com/pic.png']);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/unsupported content type "image\/png"/);
    });

    it('reports unavailable pages explicitly', async () => {
      fetchMock.mockResolvedValueOnce(
        htmlResponse('<html><body>gone</body></html>', { status: 404 }),
      );

      const [source] = await service.retrieve(['https://example.com/missing']);

      expect(source.status).toBe('error');
      expect(source.error).toMatch(/HTTP 404/);
    });

    it('discloses truncation when the download budget is exceeded', async () => {
      const big = 'x'.repeat(3 * 1024 * 1024);
      fetchMock.mockResolvedValueOnce(
        new Response(big, { headers: { 'content-type': 'text/plain' } }),
      );

      const [source] = await service.retrieve(['https://example.com/big.txt']);

      expect(source.status).toBe('ok');
      expect(source.truncated).toBe(true);
      expect(source.text).toContain('[content truncated]');
      expect((source.text ?? '').length).toBeLessThanOrEqual(12_000 + 30);
    });

    it('applies a total budget across multiple sources', async () => {
      const big = 'y'.repeat(11_000);
      fetchMock
        .mockResolvedValueOnce(
          new Response(big, { headers: { 'content-type': 'text/plain' } }),
        )
        .mockResolvedValueOnce(
          new Response(big, { headers: { 'content-type': 'text/plain' } }),
        )
        .mockResolvedValueOnce(
          new Response(big, { headers: { 'content-type': 'text/plain' } }),
        )
        .mockResolvedValueOnce(
          new Response(big, { headers: { 'content-type': 'text/plain' } }),
        );

      const sources = await service.retrieve([
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
        'https://example.com/4',
      ]);

      const totalChars = sources.reduce(
        (sum, source) => sum + (source.text?.length ?? 0),
        0,
      );
      expect(totalChars).toBeLessThanOrEqual(30_000 + 4 * 30);
      expect(sources[3].status).toBe('error');
      expect(sources[3].error).toMatch(/total source budget/);
    });

    it('never forwards credential or cookie headers', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('ok', { headers: { 'content-type': 'text/plain' } }),
      );

      await service.retrieve(['https://example.com/plain']);

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(
        expect.arrayContaining(['user-agent', 'accept']),
      );
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(
        'authorization',
      );
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(
        'cookie',
      );
    });
  });

  describe('cancellation', () => {
    it('cancels while DNS resolution is pending', async () => {
      mockedLookup.mockImplementationOnce(() => new Promise(() => {}));
      const controller = new AbortController();
      const pending = service.retrieve(
        ['https://example.com/page'],
        controller.signal,
      );
      controller.abort();
      await expect(pending).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('applies the fetch deadline to a stalled DNS lookup', async () => {
      mockedLookup.mockImplementationOnce(() => new Promise(() => {}));
      const timeout = new AbortController();
      jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
      const pending = service.retrieve(['https://example.com/page']);
      timeout.abort(new DOMException('Timed out', 'TimeoutError'));
      const [source] = await pending;
      expect(source.status).toBe('error');
      expect(source.error).toMatch(/timed out/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the caller signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.retrieve(['https://example.com/page'], controller.signal),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('applyToRequest', () => {
    it('returns the request unchanged when there are no sources', () => {
      const dto = { prompt: 'hello', systemPrompt: 'sys' };

      expect(service.applyToRequest(dto, [])).toBe(dto);
    });

    it('labels retrieved content as untrusted and keeps the URL visible', () => {
      const dto = { prompt: 'Summarize https://example.com/page' };
      const enriched = service.applyToRequest(dto, [
        {
          url: 'https://example.com/page',
          status: 'ok',
          text: 'Page body.',
          truncated: true,
        },
      ]);

      expect(enriched.prompt).toContain('Summarize https://example.com/page');
      expect(enriched.prompt).toContain('untrusted');
      expect(enriched.prompt).toContain('URL: https://example.com/page');
      expect(enriched.prompt).toContain('Page body.');
      expect(enriched.prompt).toContain('content was truncated');
      expect(dto.prompt).toBe('Summarize https://example.com/page');
    });

    it('tells the model not to invent failed sources', () => {
      const enriched = service.applyToRequest({ prompt: 'p' }, [
        { url: 'https://example.com/x', status: 'error', error: 'HTTP 503' },
      ]);

      expect(enriched.prompt).toContain('could not be retrieved (HTTP 503)');
      expect(enriched.prompt).toContain('Do not invent its content');
    });
  });
});
