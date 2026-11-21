import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  jsonToMarkdown,
  htmlToJson,
  jsonToNode,
} from '../../collaboration/collaboration.util';
import { markdownToHtml } from '@wrenlore/editor-ext';
import { EditOperation } from './mcp.schemas';

export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Content revisions deliberately exclude metadata: a browser rename must not
// be overwritten by, or invalidate, an independent content edit.
export const documentRevision = (_title: string | null, content: any) =>
  hash(content);
export const blockRef = (block: any, index: number) =>
  `b${index}:${hash(block).slice(0, 24)}`;

export async function parseMarkdown(markdown: string) {
  const json = htmlToJson(await markdownToHtml(markdown));
  jsonToNode(json).check();
  return json;
}

export function assertRevision(
  title: string | null,
  content: any,
  expected: string,
) {
  if (documentRevision(title, content) !== expected) {
    throw new ConflictException({
      code: 'REVISION_CONFLICT',
      message:
        'The page changed since you read it. Read the page again, preserve the new content, and submit a new operation key.',
    });
  }
}

// Resolve every reference against the same snapshot, then apply in descending
// order. The unchanged Yjs elements are never round-tripped through Markdown.
export function planEdits(
  content: any,
  operations: Array<EditOperation & { nodes: any[] }>,
) {
  const blocks = content.content ?? [];
  const seen = new Set<number>();
  const edits = operations.map((operation) => {
    if (operation.type === 'append')
      return { index: blocks.length, remove: 0, nodes: operation.nodes };
    const index = blocks.findIndex(
      (b: any, i: number) => blockRef(b, i) === operation.blockRef,
    );
    if (index < 0)
      throw new ConflictException({
        code: 'BLOCK_CONFLICT',
        message: 'Block reference is stale. Read the page again.',
      });
    if (seen.has(index))
      throw new BadRequestException(
        'Only one operation per target block is allowed',
      );
    seen.add(index);
    return {
      index: operation.type === 'insert_after' ? index + 1 : index,
      remove: operation.type === 'replace_block' ? 1 : 0,
      nodes: operation.nodes,
    };
  });
  // Reverse equal insertion points so multiple appends retain request order.
  const sorted = edits
    .map((e, order) => ({ ...e, order }))
    .sort(
      (a, b) => b.index - a.index || b.remove - a.remove || b.order - a.order,
    );
  const result = [...blocks];
  for (const edit of sorted)
    result.splice(edit.index, edit.remove, ...edit.nodes);
  jsonToNode({ ...content, content: result }).check();
  return sorted;
}

export function readBlocks(
  content: any,
  options: {
    offset: number;
    charOffset?: number;
    limit: number;
    maxChars: number;
    format: 'blocks' | 'outline';
  },
) {
  const all = (content.content ?? []).map((node: any, index: number) => ({
    node,
    index,
  }));
  const selected =
    options.format === 'outline'
      ? all.filter(({ node }: any) => node.type === 'heading')
      : all;
  let remaining = options.maxChars;
  const blocks = [];
  let nextOffset = options.offset;
  let nextCharOffset = options.charOffset ?? 0;
  for (const { node, index } of selected.slice(
    options.offset,
    options.offset + options.limit,
  )) {
    if (remaining <= 0) break;
    const text = jsonToMarkdown({ type: 'doc', content: [node] });
    const start = blocks.length === 0 ? (options.charOffset ?? 0) : 0;
    if (start > text.length)
      throw new BadRequestException('charOffset exceeds this block length');
    const part = text.slice(start, start + remaining);
    const truncated = start + part.length < text.length;
    blocks.push({
      blockRef: blockRef(node, index),
      type: node.type,
      markdown: part,
      charOffset: start,
      truncated,
    });
    remaining -= part.length;
    if (truncated) {
      nextCharOffset = start + part.length;
      break;
    }
    nextOffset++;
    nextCharOffset = 0;
  }
  return {
    blocks,
    nextOffset: nextOffset < selected.length ? nextOffset : null,
    nextCharOffset,
    totalBlocks: selected.length,
  };
}
