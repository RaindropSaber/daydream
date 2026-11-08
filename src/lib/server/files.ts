import { currentAccount } from "./account-context";
import { database } from "./db";
import fs from "node:fs/promises";
import path from "node:path";
import { assert, type Json } from "../domain";
import { dataDir } from "./settings";
export async function mediaPath(file: string, mustExist = true) {
  await fs.mkdir(path.resolve(dataDir(), "media"), { recursive: true });
  const base = await fs.realpath(path.resolve(dataDir(), "media"));
  assert(
    typeof file === "string" && !file.includes("\0") && !file.includes("\\"),
    "媒体路径无效",
  );
  const target = path.resolve(base, file);
  assert(target.startsWith(base + path.sep), "媒体路径无效");
  const account = currentAccount();
  const filename = path.relative(base, target);
  if (account) {
    if (!mustExist)
      await database().query(
        "INSERT INTO media_owners(filename,user_id) VALUES($1,$2) ON CONFLICT(filename) DO NOTHING",
        [filename, account],
      );
    const owner = (
      await database().query(
        "SELECT user_id FROM media_owners WHERE filename=$1",
        [filename],
      )
    ).rows[0];
    assert(owner?.user_id === account, "媒体不存在");
  }
  if (mustExist) {
    const real = await fs.realpath(target);
    assert(real.startsWith(base + path.sep), "媒体路径无效");
    return real;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}
export async function imageSource(image: Json): Promise<string> {
  if (image.file) {
    assert(/^[\w.-]+\.(?:jpg|png)$/.test(image.file), "设定图片引用无效");
    const file = await mediaPath(image.file);
    const stat = await fs.stat(file);
    assert(stat.size <= 20 * 1024 * 1024, "图片超过20MB");
    return (
      `data:image/${image.file.endsWith(".png") ? "png" : "jpeg"};base64,` +
      (await fs.readFile(file)).toString("base64")
    );
  }
  assert(
    typeof image.url === "string" && image.url.startsWith("https://"),
    "图片地址无效",
  );
  return image.url;
}
