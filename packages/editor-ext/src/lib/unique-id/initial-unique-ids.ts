import { Editor, findChildren } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import type { UniqueIDOptions } from '@tiptap/extension-unique-id';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { Doc } from 'yjs';

type InitialIdOptions = Pick<
  UniqueIDOptions,
  'types' | 'attributeName' | 'generateID'
>;
type CollaborativeDocument = { document?: Doc; field?: string };

/** Initial IDs are a write. False means the editor is not safe to write yet. */
export function initializeUniqueIds(
  editor: Editor,
  options: InitialIdOptions,
  collaboration?: CollaborativeDocument,
): boolean {
  if (editor.isDestroyed) return true;
  const { state, view } = editor;
  if (collaboration?.document) {
    const fragment = collaboration.document.getXmlFragment(
      collaboration.field || 'default',
    );
    if (fragment.length > 0) {
      try {
        const remote = Node.fromJSON(
          editor.schema,
          yXmlFragmentToProsemirrorJSON(fragment),
        );
        remote.check();
        if (!remote.eq(state.doc)) return false;
      } catch {
        // Invalid or partially loaded remote content must never be erased.
        return false;
      }
    } else if (!editor.isEmpty) {
      return false;
    }
  }

  const types = Array.isArray(options.types)
    ? options.types
    : Object.keys(editor.schema.nodes);
  const missing = findChildren(
    state.doc,
    (node) =>
      types.includes(node.type.name) &&
      node.attrs[options.attributeName] === null,
  );
  // Even a no-op dispatch can make the sync plugin write a stale view.
  if (!missing.length) return true;
  const tr = state.tr;
  for (const { node, pos } of missing) {
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      [options.attributeName]: options.generateID({ node, pos }),
    });
  }
  tr.setMeta('addToHistory', false);
  tr.setMeta('__uniqueIDTransaction', true);
  view.dispatch(tr);
  return true;
}
