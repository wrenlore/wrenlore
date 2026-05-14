import { AiAction } from "@/wrenlore/ai/types/ai.types.ts";
import {
  IconSparkles,
  IconList,
  IconTrash,
  IconRefresh,
  IconCheck,
  IconArrowDownLeft,
  IconCopy,
  IconTextPlus,
  IconAlignJustified,
  IconPencilPlus,
} from "@tabler/icons-react";

interface CommandItem {
  name: string;
  id: string;
  icon?: typeof IconSparkles;
  action?: AiAction;
  prompt?: string;
  subCommandSet?: CommandSet;
}

type CommandSet = "main" | "result";

const mainItems: CommandItem[] = [
  {
    id: "improve-writing",
    name: "Improve writing",
    icon: IconSparkles,
    action: AiAction.IMPROVE_WRITING,
  },
  {
    id: "make-longer",
    name: "Make longer",
    icon: IconTextPlus,
    action: AiAction.MAKE_LONGER,
  },
  {
    id: "make-shorter",
    name: "Make shorter",
    icon: IconAlignJustified,
    action: AiAction.MAKE_SHORTER,
  },
  {
    id: "summarize",
    name: "Summarise",
    icon: IconList,
    action: AiAction.SUMMARIZE,
  },
  {
    id: "continue-writing",
    name: "Continue writing",
    icon: IconPencilPlus,
    action: AiAction.CONTINUE_WRITING,
  },
];

const resultItems: CommandItem[] = [
  { id: "result-replace", name: "Replace", icon: IconCheck },
  { id: "result-insert-below", name: "Insert below", icon: IconArrowDownLeft },
  { id: "result-copy", name: "Copy", icon: IconCopy },
  { id: "result-discard", name: "Discard", icon: IconTrash },
  {
    id: "result-try-again",
    name: "Try again",
    icon: IconRefresh,
  },
];

const commandItems: Record<CommandSet, CommandItem[]> = {
  main: mainItems,
  result: resultItems,
};

export type { CommandItem, CommandSet };
export { commandItems };
