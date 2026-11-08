import { assert, type Json } from "../domain";
import { CREATIVE_FIELDS, type CreativeSpec } from "../creative-spec";

export function validateCreativeSpec(value: unknown): CreativeSpec {
  if (value == null) return {};
  assert(
    typeof value === "object" && !Array.isArray(value),
    "项目创作规范格式无效",
  );
  const result: CreativeSpec = {};
  for (const key of Object.keys(CREATIVE_FIELDS) as (keyof CreativeSpec)[]) {
    const field = (value as Json)[key];
    if (field == null) continue;
    assert(
      typeof field === "string" && field.length <= 2000,
      "每项创作规范最多2000字",
    );
    result[key] = field.trim();
  }
  return result;
}
