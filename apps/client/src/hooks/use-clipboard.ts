// Source: https://github.com/mantinedev/mantine/blob/master/packages/@mantine/hooks/src/use-clipboard/use-clipboard.ts
// polyfilled to support execCommand fallback
import { useState } from "react";
import { execCommandCopy } from "@wrenlore/editor-ext";

export type UseClipboardOptions = {
  timeout?: number;
  /** Called whenever a copy attempt fails, with the underlying error. */
  onError?: (error: Error) => void;
};

export type UseClipboardReturnValue = {
  copy: (value: string) => void;
  reset: () => void;
  error: Error | null;
  copied: boolean;
};

export function useClipboard(
  options: UseClipboardOptions = { timeout: 2000 },
): UseClipboardReturnValue {
  const [error, setError] = useState<Error | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyTimeout, setCopyTimeout] = useState<number | null>(null);

  const handleCopyResult = (value: boolean) => {
    window.clearTimeout(copyTimeout!);
    setCopyTimeout(window.setTimeout(() => setCopied(false), options.timeout));
    setCopied(value);
  };

  const toError = (err: unknown) =>
    err instanceof Error ? err : new Error("Failed to copy");

  const fail = (err: unknown) => {
    const copyError = toError(err);
    setError(copyError);
    options.onError?.(copyError);
  };

  const copy = (value: string) => {
    setError(null);
    if ("clipboard" in navigator) {
      navigator.clipboard
        .writeText(value)
        .then(() => handleCopyResult(true))
        .catch(() => {
          try {
            execCommandCopy(value);
            handleCopyResult(true);
          } catch (err) {
            fail(err);
          }
        });
    } else {
      try {
        execCommandCopy(value);
        handleCopyResult(true);
      } catch (err) {
        fail(err);
      }
    }
  };

  const reset = () => {
    setCopied(false);
    setError(null);
    window.clearTimeout(copyTimeout!);
  };

  return { copy, reset, error, copied };
}
