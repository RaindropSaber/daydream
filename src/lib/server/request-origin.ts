import { AppError, assert } from "../domain";

export function checkRequestOrigin(headers: Headers, protocol: string) {
  const host = headers.get("host") || "";
  assert(
    host && !/[\s/\\?#@]/.test(host) && ["http:", "https:"].includes(protocol),
    "不允许的主机地址",
  );
  let address: URL;
  try {
    address = new URL(`${protocol}//${host}`);
  } catch {
    throw new AppError("主机地址格式无效");
  }
  const trusted = (process.env.TRUSTED_HOSTS || "localhost,127.0.0.1,[::1]")
    .split(",")
    .map((value) => value.trim());
  assert(trusted.includes(address.hostname), "不允许的主机地址");
  // Next can normalize a loopback URL to localhost. The browser sends Origin
  // for the actual Host, so compare against that authority, not nextUrl.origin.
  const origin = headers.get("origin");
  assert(!origin || origin === address.origin, "不允许跨站请求");
}
