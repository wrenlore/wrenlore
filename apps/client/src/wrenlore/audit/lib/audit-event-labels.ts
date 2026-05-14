export function getEventLabel(event: string) {
  return event
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const eventFilterOptions: Array<{ value: string; label: string }> = [];
