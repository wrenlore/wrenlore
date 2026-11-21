// Source: https://github.com/mantinedev/mantine/blob/master/packages/@mantine/core/src/components/CopyButton/CopyButton.tsx - MIT
// modified to use the polyfilled clipboard api
import React from "react";
import { useClipboard } from "@/hooks/use-clipboard";
import { useProps } from "@mantine/core";

interface CopyButtonProps {
  /** Children callback, provides current status and copy function as an argument */
  children: (payload: {
    copied: boolean;
    copy: () => void;
    error: Error | null;
  }) => React.ReactNode;

  /** Value that is copied to the clipboard when the button is clicked */
  value: string;

  /** Copied status timeout in ms @default `1000` */
  timeout?: number;

  /** Called whenever a copy attempt fails, e.g. to show feedback */
  onError?: (error: Error) => void;
}

const defaultProps = {
  timeout: 1000,
} satisfies Partial<CopyButtonProps>;

export function CopyButton(props: CopyButtonProps) {
  const { children, timeout, value, onError, ...others } = useProps(
    "CopyButton",
    defaultProps,
    props,
  );
  const clipboard = useClipboard({ timeout, onError });
  const copy = () => clipboard.copy(value);
  return (
    <>
      {children({
        copy,
        copied: clipboard.copied,
        error: clipboard.error,
        ...others,
      })}
    </>
  );
}

CopyButton.displayName = "@mantine/core/CopyButton";
