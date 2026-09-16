import { applyShareSeoMetadata } from './share-seo.controller';

describe('applyShareSeoMetadata', () => {
  const indexHtml =
    '<html><head><title>WrenLore</title><!--meta-tags--></head><body></body></html>';

  it('emits escaped title metadata for a shared page', () => {
    const html = applyShareSeoMetadata(indexHtml, {
      title: 'Root <Plan> "A"',
      searchIndexing: true,
    });

    expect(html).toContain('<title>Root &lt;Plan&gt; &quot;A&quot;</title>');
    expect(html).toContain(
      '<meta property="og:title" content="Root &lt;Plan&gt; &quot;A&quot;" />',
    );
    expect(html).toContain(
      '<meta property="twitter:title" content="Root &lt;Plan&gt; &quot;A&quot;" />',
    );
    expect(html).not.toContain('noindex');
  });

  it('truncates escaped metadata titles at 80 characters', () => {
    const html = applyShareSeoMetadata(indexHtml, {
      title: 'x'.repeat(90),
      searchIndexing: true,
    });

    const match = html.match(/<title>(.*?)<\/title>/);
    expect(match[1]).toHaveLength(80);
    expect(match[1].endsWith('…')).toBe(true);
  });

  it('emits noindex when search indexing is disabled', () => {
    const html = applyShareSeoMetadata(indexHtml, {
      title: 'Private share',
      searchIndexing: false,
    });

    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});
