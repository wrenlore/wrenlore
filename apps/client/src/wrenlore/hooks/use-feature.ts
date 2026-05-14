import { useAtomValue } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { Feature } from "@/wrenlore/features";

export function useHasFeature(feature: Feature): boolean {
  const workspace = useAtomValue(workspaceAtom);

  switch (feature) {
    case Feature.AI:
      return workspace?.settings?.ai?.generative === true || workspace?.settings?.ai?.search === true;
    case Feature.AI_SEARCH:
      return workspace?.settings?.ai?.search === true;
    case Feature.GENERATIVE_AI:
      return workspace?.settings?.ai?.generative === true;
    case Feature.DISABLE_PUBLIC_SHARING:
    case Feature.TRASH_RETENTION:
    case Feature.COMMENT_RESOLUTION:
      return true;
    case Feature.CONFLUENCE_IMPORT:
    case Feature.DOCX_IMPORT:
    case Feature.PAGE_PERMISSIONS:
      return false;
    default:
      return true;
  }
}
