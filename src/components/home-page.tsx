"use client";
import type { AuthUser } from "@/lib/auth-types";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Clapperboard,
  Film,
  Layers3,
  Play,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { AccountHeader } from "./studio/account-header";
import { LoginDialog } from "./login-form";
import { Button } from "./ui/button";
const stages = [
  {
    number: "01",
    title: "写下故事",
    description: "从一个念头出发，与 AI 一起构建人物、世界和完整章节。",
    Icon: BookOpenText,
  },
  {
    number: "02",
    title: "构想镜头",
    description: "把文字变成分镜，让画面、运镜与声音都有迹可循。",
    Icon: Layers3,
  },
  {
    number: "03",
    title: "让画面发生",
    description: "生成人物、场景与视频片段，挑选最贴近想象的版本。",
    Icon: WandSparkles,
  },
  {
    number: "04",
    title: "完成你的作品",
    description: "审阅每一个片段，合成、预览，再导出属于你的成片。",
    Icon: Film,
  },
];
export function HomePage({
  user,
  initialLogin,
}: {
  user: AuthUser | null;
  initialLogin: boolean;
}) {
  const [loginOpen, setLoginOpen] = useState(initialLogin);
  function start() {
    if (user) window.location.assign("/workspace");
    else setLoginOpen(true);
  }
  function changeLogin(open: boolean) {
    setLoginOpen(open);
    if (!open && new URLSearchParams(window.location.search).has("login"))
      window.history.replaceState(null, "", "/");
  }
  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-40">
        <AccountHeader
          user={user ?? undefined}
          onHome={() => window.location.assign("/")}
          onModels={() => window.location.assign("/models")}
          onLogin={() => setLoginOpen(true)}
        />
      </div>
      <main>
        <section className="relative isolate overflow-hidden border-b">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_15%,var(--color-primary)_-220%,transparent_65%)]"
          />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 sm:px-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:py-28">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
                <Sparkles className="size-3.5" />
                邀请制内测 · 从故事到成片的 AI 创作工作台
              </div>
              <h1 className="text-4xl font-semibold tracking-tight leading-[1.25] sm:text-5xl xl:text-6xl">
                让白日梦，
                <br />
                <span className="text-primary">成为影像。</span>
              </h1>
              <p className="mt-6 max-w-md text-base leading-8 text-muted-foreground">
                每一个好故事，都值得被看见。
                <br />
                把灵感写成故事，把故事变成镜头，
                <br className="hidden sm:block" />与 AI 一起完成你的下一部作品。
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Button
                  size="lg"
                  className="h-12 rounded-xl px-6"
                  onClick={start}
                >
                  {user ? "进入工作台" : "申请体验"}
                  <ArrowRight className="size-4" />
                </Button>
                <a
                  href="#how-it-works"
                  className="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  <Play className="size-3.5" />
                  了解创作流程
                </a>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                故事 · 分镜 · 素材 · 视频 · 成片，一个工作区完成
              </p>
            </div>
            <div
              className="relative mx-auto w-full max-w-xl"
              aria-label="从故事到影像的创作流程示意"
            >
              <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-primary/5">
                <div className="flex items-center gap-2 border-b px-5 py-3.5">
                  <span className="size-2 rounded-full bg-primary/50" />
                  <span className="size-2 rounded-full bg-primary/25" />
                  <span className="size-2 rounded-full bg-primary/10" />
                  <span className="ml-2 text-xs text-muted-foreground">
                    创作中的一个白日梦
                  </span>
                  <Clapperboard className="ml-auto size-4 text-primary" />
                </div>
                <div className="p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] tracking-[0.22em] text-primary">
                        STORY TO SCREEN
                      </p>
                      <h2 className="mt-1.5 text-base font-semibold">
                        在光消失之前
                      </h2>
                    </div>
                    <span className="rounded-full bg-primary/5 px-2.5 py-1 text-[10px] text-primary">
                      创作示意
                    </span>
                  </div>
                  <div className="relative flex aspect-video items-end overflow-hidden rounded-xl bg-[#202637] p-5 text-white">
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_25%,#e3b987_0%,#a57f67_12%,#4d5268_35%,#202637_70%)]"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute -bottom-8 -left-10 h-32 w-[80%] -rotate-12 rounded-[50%] bg-[#181f2d]"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute -bottom-12 -right-10 h-40 w-[65%] rotate-12 rounded-[50%] bg-[#141b27]"
                    />
                    <div className="relative">
                      <p className="mb-2 text-[10px] tracking-widest text-white/60">
                        第一幕 · 黄昏
                      </p>
                      <p className="text-sm leading-6 text-white/90">
                        她循着最后一束光，
                        <br />
                        走向故事开始的地方。
                      </p>
                    </div>
                    <span className="absolute right-4 top-4 rounded bg-black/15 px-2 py-1 text-[10px] text-white/65">
                      镜头 01
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {["故事已就绪", "分镜已展开", "想象正在成形"].map(
                      (text, i) => (
                        <div
                          key={text}
                          className="rounded-lg border bg-muted/25 px-2 py-3"
                        >
                          <span className="text-[10px] text-primary">
                            0{i + 1}
                          </span>
                          <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                            {text}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                  <div
                    className="mt-5 flex h-7 items-center gap-1.5"
                    aria-hidden="true"
                  >
                    {[
                      3, 5, 4, 6, 3, 5, 4, 3, 6, 5, 4, 6, 3, 4, 5, 3, 4, 6, 5,
                      4, 3, 5, 4, 6, 3, 4, 5, 3,
                    ].map((height, i) => (
                      <span
                        key={i}
                        style={{ height: `${height * 4}px` }}
                        className="flex-1 rounded-sm bg-primary/15"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          id="how-it-works"
          className="mx-auto max-w-7xl scroll-mt-20 px-6 py-16 sm:px-10 lg:py-20"
        >
          <div className="mb-9">
            <p className="text-xs font-medium text-primary">留给你想象的空间</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">
              从一句灵感，到一部作品
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              不必在工具之间来回切换，让每一步创作自然接续。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stages.map(({ number, title, description, Icon }) => (
              <article key={number} className="rounded-xl border bg-card p-6">
                <div className="mb-7 flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/7 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    {number}
                  </span>
                </div>
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-10">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border bg-primary/5 p-7 sm:flex-row sm:items-center sm:p-10">
            <div>
              <h2 className="text-xl font-semibold">
                你的下一个故事，从这里开始。
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                把脑海里的画面，带到屏幕上。
              </p>
            </div>
            <Button className="shrink-0 rounded-lg" onClick={start}>
              {user ? "打开创作空间" : "申请加入内测"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>
      <footer className="border-t px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <Clapperboard className="size-3.5" />
            Daydream · 让白日梦成为影像
          </span>
          {user && (
            <Link href="/workspace" className="hover:text-foreground">
              进入我的工作台 →
            </Link>
          )}
        </div>
      </footer>
      <LoginDialog open={loginOpen} onOpenChange={changeLogin} />
    </div>
  );
}
