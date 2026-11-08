// Muted indigo, jade, amber, coral and violet with clearer light/dark contrast.
export const AVATAR_COLORS = [
  "#536A98",
  "#77A68F",
  "#E4B66F",
  "#CE8172",
  "#826A9F",
] as const;

const seedHash = (seed: string) =>
  Array.from(seed).reduce((sum, character) => sum + character.charCodeAt(0), 0);

function showsBackground(hash: number) {
  // The service's beam generator uses an unscaled circle for these seeds.
  // Keep its centre far enough from the outer circle to expose a clear crescent.
  if (hash % 3 !== 0 || Math.floor(hash / 10) % 2 !== 0) return false;
  const digit = hash % 10;
  const x = 4 - digit;
  const y =
    Math.floor(hash / 100) % 2 === 0 ? x : digit < 5 ? digit + 4 : digit;
  return x * x + y * y >= 36;
}

function avatarSeed(phone: string) {
  const hash = seedHash(phone);
  if (showsBackground(hash)) return phone;
  for (let variation = 0; variation < 1000; variation++) {
    const suffix = `:${variation}`;
    if (showsBackground(hash + seedHash(suffix))) return phone + suffix;
  }
  throw new Error("无法生成具有可见背景的头像");
}

export function avatarUrl(phone: string) {
  const params = new URLSearchParams({
    name: avatarSeed(phone),
    variant: "beam",
  });
  // This endpoint expects repeated colors parameters, rather than a CSV string.
  for (const color of AVATAR_COLORS) params.append("colors", color);
  return `https://boring-avatars-api.vercel.app/api/avatar?${params}`;
}
