export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const requestHost =
      forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const protocol = forwardedProtocol ?? new URL(request.url).protocol.slice(0, -1);
    const expectedOrigin = new URL(`${protocol}://${requestHost}`).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
