/**
 * Normalize pasted input into a bare lowercase domain for providers that
 * only accept one (Serpstat via treg). Accepts a full URL with protocol,
 * path, query string or port, as well as a bare host.
 * Returns null when the input has no usable hostname.
 */
export function toBareDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  // Other schemes parse hosts differently, so reject them instead of
  // silently producing a host the provider would not recognize.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/\.$/, "");
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host)
  ) {
    return null;
  }
  return host;
}
