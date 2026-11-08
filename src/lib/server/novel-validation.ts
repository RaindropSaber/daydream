import { assert, digest, type Json } from "../domain";
import { chapterCount, type NovelPlan } from "../novel";
import type { Story } from "../stories";
function str(v: unknown, max: number) {
  assert(
    typeof v === "string" && v.length <= max,
    "长篇方案文本格式无效或过长",
  );
  return v;
}
export function novelContent(v: Json): NovelPlan {
  assert(v && typeof v === "object", "长篇方案格式无效");
  assert(
    Number.isInteger(v.target_words) &&
      v.target_words >= 50000 &&
      v.target_words <= 2000000,
    "目标篇幅应为5万至200万字",
  );
  assert(
    Number.isInteger(v.chapter_words) &&
      v.chapter_words >= 1500 &&
      v.chapter_words <= 5000,
    "每章篇幅应为1500至5000字",
  );
  assert(Array.isArray(v.volumes) && v.volumes.length <= 30, "分卷最多30卷");
  const volumes = v.volumes.map((x: Json) => {
    assert(
      x &&
        Number.isInteger(x.start) &&
        Number.isInteger(x.end) &&
        x.start > 0 &&
        x.end >= x.start &&
        x.end - x.start < 80,
      "分卷章节范围无效",
    );
    return {
      title: str(x.title, 100),
      start: x.start,
      end: x.end,
      goal: str(x.goal, 6000),
      climax: str(x.climax, 6000),
      resolution: str(x.resolution, 6000),
    };
  });
  const plan: NovelPlan = {
    idea: str(v.idea, 10000),
    target_words: v.target_words,
    chapter_words: v.chapter_words,
    ending: str(v.ending, 12000),
    volumes,
    audit: null,
    completed: !!v.completed,
  };
  if (volumes.length) {
    assert(
      volumes[0].start === 1 &&
        volumes.at(-1)!.end === chapterCount(plan) &&
        volumes.every(
          (x: { start: number }, i: number) =>
            i === 0 || x.start === volumes[i - 1].end + 1,
        ),
      "分卷必须连续覆盖预计的全部章节",
    );
  }
  if (v.audit) {
    assert(
      Array.isArray(v.audit.issues) &&
        v.audit.issues.length <= 50 &&
        Number.isInteger(v.audit.revision),
      "全书检查格式无效",
    );
    plan.audit = {
      report: str(v.audit.report, 12000),
      issues: v.audit.issues.map((x: unknown) => str(x, 1000)),
      revision: v.audit.revision,
    };
  }
  return plan;
}
const chapterBasis = (c: Json) => ({
  id: c.id,
  title: c.title,
  summary: c.summary,
  text: c.text,
});
export function invalidateNovel(
  previous: Story,
  next: Pick<
    Story,
    | "novel"
    | "chapters"
    | "title"
    | "premise"
    | "genre"
    | "theme"
    | "world"
    | "characters"
    | "outline"
  >,
) {
  const basis = (s: typeof next) => [
    s.title,
    s.premise,
    s.genre,
    s.theme,
    s.world,
    s.characters,
    s.outline,
    s.novel.idea,
    s.novel.target_words,
    s.novel.chapter_words,
    s.novel.ending,
    s.novel.volumes,
  ];
  let changed = digest(basis(previous)) !== digest(basis(next));
  let any = changed || previous.chapters.length !== next.chapters.length;
  next.chapters.forEach((c, i) => {
    changed ||=
      digest(chapterBasis(c)) !==
      digest(chapterBasis(previous.chapters[i] || {}));
    if (changed) {
      c.memory = null;
      c.review = "";
      c.issues = [];
      c.needs_review = !!c.text.trim();
      any = true;
    } else {
      // Memory and check results are derived, never trusted from an editor request.
      c.memory = previous.chapters[i].memory;
      c.review = previous.chapters[i].review;
      c.issues = previous.chapters[i].issues;
      c.needs_review = previous.chapters[i].needs_review;
    }
  });
  next.novel.audit = any ? null : structuredClone(previous.novel.audit);
  next.novel.completed = any ? false : previous.novel.completed;
}
