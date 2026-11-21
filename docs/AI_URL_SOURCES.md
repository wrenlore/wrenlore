# Reading a URL with Ask AI

In the editor, open `/ai` and ask a question containing a public HTTP or HTTPS URL, for example:

> Summarize https://github.com/wrenlore/wrenlore/blob/master/README.md and include the source link.

WrenLore retrieves the supplied page before sending the request to the configured AI provider. The preview shows retrieval progress, then the generated answer. Use **Insert below** or **Replace** to apply it to the document.

Only URLs in the custom instruction are retrieved. URLs in selected document text, retrieved pages or model output are not followed. Ordinary rewriting and summarization without an explicit URL instruction keep their existing behavior.

## Retrieval behavior

- Up to four distinct URLs per request.
- Public HTML, Markdown and text formats, including JSON/XML; no JavaScript execution, browser login, cookies or authentication headers.
- Public GitHub file links are rewritten to their raw file URLs.
- Up to five redirects per source, with address validation at each hop.
- A 12-second deadline per source covers DNS resolution, redirects and response reading.
- At most 2 MiB downloaded per source, 12,000 extracted characters per source and 30,000 source characters per request, plus truncation notices and source labels.
- Unavailable sources and truncated content are identified in the prompt. The model is instructed to report unavailable sources and cite the supplied URLs.

Private, loopback, link-local and other blocked addresses are rejected, including IPv4-mapped IPv6. DNS answers are validated and pinned to the connection so a second lookup cannot redirect the request into a private network. URL credentials are rejected before GitHub rewriting. Retrieved material is labelled as untrusted source data; it does not become a system instruction.

## API

`POST /api/wren-ai/generate` and `POST /api/wren-ai/generate/stream` accept the optional `instruction` field alongside `prompt`:

```json
{
  "instruction": "Summarize https://example.com/article",
  "prompt": "Summarize https://example.com/article"
}
```

`prompt` may include selected editor context. URL extraction uses only `instruction` (maximum 20,000 characters), which keeps incidental links in document context from becoming network requests. These endpoints use the existing workspace authentication and configured AI route.

The streaming endpoint emits `fetching_source`, `source_fetched` or `source_failed` status events, then the existing content frames and `[DONE]`. The non-streaming response includes source summaries when URLs were supplied.

## Verification

```sh
pnpm --filter server exec jest --runInBand --testPathPatterns=core/ai
pnpm test:editor-ext
pnpm build
```

`scripts/ai-editor-insert-regression.cjs` runs the full editor in Chromium and WebKit against a running test workspace. It supplies a synthetic streamed response containing links, code and a table, exercises **Insert below** and **Replace**, checks the document model and debounced server save, and reopens the page in a fresh browser context. It removes its temporary pages afterward. Setup and environment variables are documented at the top of the script; use a private, short-lived test credential and do not commit it.

This regression covers a toolbar lifecycle bug: remounting the formatting toolbar while a React mark/node view is being inserted can recreate the collaboration binding and restore the old document. The toolbar stays mounted while its existing visibility checks hide it during auxiliary menus.

Preview auto-scroll remains a separate follow-up.
