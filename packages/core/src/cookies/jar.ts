import { CookieJar } from "tough-cookie";

export async function cookieHeaderFor(jarJson: string | null, url: string): Promise<string> {
  const jar = jarJson ? await CookieJar.fromJSON(jarJson) : new CookieJar();
  return (await jar.getCookieString(url)) ?? "";
}

export async function storeSetCookies(jarJson: string | null, url: string, setCookies: string[]): Promise<string> {
  const jar = jarJson ? await CookieJar.fromJSON(jarJson) : new CookieJar();
  for (const c of setCookies) {
    try {
      await jar.setCookie(c, url);
    } catch {
      /* ignore malformed */
    }
  }
  return JSON.stringify(jar.toJSON());
}

export async function listCookies(jarJson: string | null): Promise<Array<{ key: string; value: string; domain?: string; path?: string }>> {
  if (!jarJson) return [];
  const jar = await CookieJar.fromJSON(jarJson);
  const cookies = await jar.serialize();
  return (cookies.cookies ?? []).map((c) => ({
    key: c.key ?? "",
    value: c.value ?? "",
    domain: typeof c.domain === "string" ? c.domain : undefined,
    path: typeof c.path === "string" ? c.path : undefined
  }));
}

export async function clearCookies(): Promise<string> {
  return JSON.stringify(new CookieJar().toJSON());
}

export async function upsertCookie(
  jarJson: string | null,
  cookie: { key: string; value: string; domain: string; path?: string }
): Promise<string> {
  const jar = jarJson ? await CookieJar.fromJSON(jarJson) : new CookieJar();
  const url = `https://${cookie.domain.replace(/^\./, "")}${cookie.path ?? "/"}`;
  await jar.setCookie(`${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path ?? "/"}`, url);
  return JSON.stringify(jar.toJSON());
}
