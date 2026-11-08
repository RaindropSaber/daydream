"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Json } from "@/lib/types";

export function StoryboardTimeline({
  shots,
  selectedId,
  onSelect,
  onResize,
  onInsert,
  onDelete,
  disabled,
}: {
  shots: Json[];
  selectedId: string;
  onSelect: (id: string) => void;
  onResize: (id: string, duration: number) => void;
  onInsert: (id: string, side: "before" | "after") => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  const [scale, setScale] = useState(88);
  const drag = useRef<{ x: number; duration: number } | null>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = scroller.current;
    const button = selectedButton.current;
    if (!track || !button) return;
    const bounds = track.getBoundingClientRect();
    const shotBounds = button.getBoundingClientRect();
    const left =
      shotBounds.left < bounds.left
        ? shotBounds.left - bounds.left
        : shotBounds.right > bounds.right
          ? shotBounds.right - bounds.right
          : 0;
    if (left) track.scrollBy({ left, behavior: "smooth" });
  }, [selectedId]);
  const total = shots.at(-1)?.end || 0;
  const index = shots.findIndex((shot) => shot.id === selectedId);
  const step = Math.max(scale < 50 ? 2 : 1, Math.ceil(total / 100));
  const ticks = Array.from(
    { length: Math.ceil(total / step) },
    (_, i) => i * step,
  );
  return (
    <section aria-label="分镜时间轴" className="min-w-0 px-3 pb-2 pt-2">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs font-medium">
          {index >= 0 ? `镜头 ${String(index + 1).padStart(2, "0")}` : "分镜"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onInsert(selectedId, "before")}
          title="在选中镜头前插入镜头"
        >
          <Plus />
          {shots.length ? "前插" : "添加镜头"}
        </Button>
        {!!shots.length && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onInsert(selectedId, "after")}
              title="在选中镜头后插入镜头"
            >
              <Plus />
              后插
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="删除选中镜头"
              onClick={() => onDelete(selectedId)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {shots.length} 镜 · {Number(total.toFixed(3))} 秒
        </span>
        <input
          aria-label="时间轴缩放"
          title="时间轴缩放"
          type="range"
          min="32"
          max="160"
          step="8"
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
          className="ml-2 w-16 accent-primary"
        />
      </div>
      <div
        ref={scroller}
        className="overflow-x-auto overscroll-x-contain"
        aria-label="横向滚动镜头轨道"
      >
        <div
          className="relative"
          style={{ width: Math.max(1, total * scale + 24), minWidth: "100%" }}
        >
          <div
            aria-hidden="true"
            className="relative h-5 text-[10px] tabular-nums text-muted-foreground"
          >
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute bottom-0 h-3 border-l pl-1"
                style={{ left: tick * scale }}
              >
                {tick}s
              </span>
            ))}
            {!!shots.length && (
              <span
                className="absolute bottom-0 h-3 border-l pl-1"
                style={{ left: total * scale }}
              >
                {Number(total.toFixed(2))}s
              </span>
            )}
          </div>
          <div
            role="tablist"
            aria-label="镜头切换"
            className="relative h-14"
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                  event.key,
                ) &&
                (event.target as HTMLElement).getAttribute("role") === "tab"
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? shots.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            shots.length - 1,
                            index + (event.key === "ArrowRight" ? 1 : -1),
                          ),
                        );
                if (shots[next]) {
                  onSelect(shots[next].id);
                  (
                    event.currentTarget.querySelectorAll('[role="tab"]')[
                      next
                    ] as HTMLElement
                  )?.focus();
                }
              }
            }}
          >
            {shots.map((shot, shotIndex) => (
              <div
                key={shot.id}
                className="absolute inset-y-0 pr-0.5"
                style={{
                  left: shot.start * scale,
                  width: Math.max(1, (shot.end - shot.start) * scale),
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={shot.id === selectedId}
                  tabIndex={shot.id === selectedId ? 0 : -1}
                  aria-label={`镜头${shotIndex + 1}，${shot.start}至${shot.end}秒`}
                  aria-controls="storyboard-shot-editor"
                  ref={shot.id === selectedId ? selectedButton : undefined}
                  title={`镜头 ${shotIndex + 1} · ${shot.start}–${shot.end} 秒`}
                  className={`flex h-full w-full flex-col justify-center overflow-hidden rounded-md border px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${shot.id === selectedId ? "border-primary bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
                  onClick={() => onSelect(shot.id)}
                >
                  <span className="block w-full truncate text-xs font-medium">
                    {String(shotIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="block w-full truncate text-[10px] tabular-nums">
                    {Number((shot.end - shot.start).toFixed(3))}s
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`拖动调整镜头${shotIndex + 1}时长`}
                  title="拖动调整时长，后续镜头顺延"
                  className="absolute inset-y-1 right-0.5 w-2 cursor-ew-resize touch-none rounded bg-primary/20 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary disabled:hidden"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      x: event.clientX,
                      duration: shot.end - shot.start,
                    };
                    onSelect(shot.id);
                  }}
                  onPointerMove={(event) => {
                    if (
                      drag.current &&
                      event.currentTarget.hasPointerCapture(event.pointerId)
                    )
                      onResize(
                        shot.id,
                        Math.max(
                          0.1,
                          Math.round(
                            (drag.current.duration +
                              (event.clientX - drag.current.x) / scale) *
                              10,
                          ) / 10,
                        ),
                      );
                  }}
                  onPointerUp={(event) => {
                    drag.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      onResize(
                        shot.id,
                        Math.max(
                          0.1,
                          shot.end -
                            shot.start +
                            (event.key === "ArrowRight" ? 0.1 : -0.1),
                        ),
                      );
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
