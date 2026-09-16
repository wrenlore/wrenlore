const FALLBACK_FILE_NAMES: Record<string, string> = {
  image: 'image',
  video: 'video',
  attachment: 'file',
  drawio: 'diagram.drawio.svg',
  excalidraw: 'diagram.excalidraw.svg',
};

export function getPastedAttachmentFileName(options: {
  nodeTypeName: string;
  src?: string;
  url?: string;
  name?: string;
}): string {
  const explicitName = cleanFileName(options.name);
  if (explicitName) {
    return explicitName;
  }

  const urlBasename = getUrlPathBasename(options.src || options.url || '');
  if (urlBasename) {
    return urlBasename;
  }

  return FALLBACK_FILE_NAMES[options.nodeTypeName] ?? 'file';
}

function getUrlPathBasename(input: string): string | undefined {
  const path = getUrlPathname(input);
  const basename = path.split('/').pop();
  if (!basename) {
    return undefined;
  }

  try {
    return cleanFileName(decodeURIComponent(basename));
  } catch {
    return cleanFileName(basename);
  }
}

function getUrlPathname(input: string): string {
  try {
    return new URL(input, 'http://wrenlore.local').pathname;
  } catch {
    return input.split('#')[0].split('?')[0];
  }
}

function cleanFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
