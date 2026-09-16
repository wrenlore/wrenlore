export const MEDIA_ACCESSIBILITY_DESCRIPTION_ATTR = 'accessibilityDescription';
export const MEDIA_ACCESSIBILITY_DESCRIPTION_DATA_ATTR =
  'data-accessibility-description';

export function normalizeAccessibilityDescription(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getAccessibilityDescription(
  value: unknown,
  fallback?: unknown,
): string {
  return (
    normalizeAccessibilityDescription(value) ??
    normalizeAccessibilityDescription(fallback) ??
    ''
  );
}

export function getAccessibilityDescriptionUpdate(
  value: unknown,
  legacyAttributeNames: string[] = [],
): Record<string, string | null> {
  const description = normalizeAccessibilityDescription(value) ?? null;
  const update: Record<string, string | null> = {
    [MEDIA_ACCESSIBILITY_DESCRIPTION_ATTR]: description,
  };

  for (const name of legacyAttributeNames) {
    update[name] = description;
  }

  return update;
}
