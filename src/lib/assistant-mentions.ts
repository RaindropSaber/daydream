import { CREATION_SKILLS, type CreationSkill } from "./creation-flow";

export const MENTION_PATTERN =
  /@(skill|stage|asset|resource):([a-zA-Z0-9_-]+)/g;
export function mentionedSkills(text: string): CreationSkill[] {
  return [
    ...new Set(
      Array.from(text.matchAll(new RegExp(MENTION_PATTERN)), (m) =>
        m[1] === "skill" && Object.hasOwn(CREATION_SKILLS, m[2])
          ? (m[2] as CreationSkill)
          : null,
      ).filter((skill): skill is CreationSkill => !!skill),
    ),
  ];
}
export type MentionOption = {
  token: string;
  label: string;
  kind: "skill" | "stage" | "asset" | "resource";
  description: string;
  preview?: {
    images?: { url: string }[];
    description?: string;
    version?: string;
    status?: string;
  };
};
export function mentionQuery(value: string, caret: number) {
  const match = value
    .slice(0, caret)
    .match(/(?:^|[\s，。；（(])@([^\s@，。；（）()]*)$/);
  return match
    ? { start: caret - match[1].length - 1, end: caret, query: match[1] }
    : null;
}
