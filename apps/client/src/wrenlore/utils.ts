import { getAppUrl } from "@/lib/config";

export function getHostnameUrl(hostname?: string) {
  if (!hostname) return getAppUrl();
  const protocol = window.location.protocol || "https:";
  return `${protocol}//${hostname}`;
}

export function exchangeTokenRedirectUrl(hostname: string, exchangeToken: string) {
  return `${getHostnameUrl(hostname)}/login?exchangeToken=${encodeURIComponent(exchangeToken)}`;
}
