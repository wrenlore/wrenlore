import { Node } from "@tiptap/pm/model";
import { ChangeSet, simplifyChanges } from "@tiptap/pm/changeset";
import { recreateTransform } from "@wrenlore/editor-ext";

export function compareHistory(oldContent: Node, newContent: Node) {
  const tr = recreateTransform(oldContent, newContent, {
    complexSteps: false,
    wordDiffs: true,
    simplifyDiff: true,
  });
  const changeSet = ChangeSet.create(oldContent).addSteps(
    tr.doc,
    tr.mapping.maps,
    [],
  );
  const changes = simplifyChanges(changeSet.changes, newContent);
  return {
    changes,
    // ChangeSet tracks text ranges, so an attribute/mark-only edit may have none.
    unhighlightedChanges: changes.length === 0 && !oldContent.eq(newContent),
  };
}
