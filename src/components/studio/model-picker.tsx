"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TEXT_PROVIDERS,
  type CatalogModel,
  type ModelCapability,
} from "@/lib/models";

export function ModelPicker({
  label,
  value,
  entries,
  role,
  provider,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  entries: CatalogModel[];
  role: ModelCapability;
  provider?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const choices = entries
    .filter(
      (m) =>
        (!provider || m.provider === provider) && m.capabilities.includes(role),
    )
    .sort(
      (a, b) =>
        Number(b.supported_roles.includes(role)) -
        Number(a.supported_roles.includes(role)),
    );
  const token = (model: CatalogModel) => `${model.provider}:${model.id}`;
  const current = choices.find(
    (m) => m.id === value && m.supported_roles.includes(role),
  );
  const filtered = choices.filter((m) =>
    `${m.name} ${m.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectable = filtered.filter((m) => m.supported_roles.includes(role));
  const active =
    selectable.find((m) => token(m) === activeToken) ??
    selectable.find((m) => m === current) ??
    selectable[0];
  const activeIndex = active ? filtered.indexOf(active) : -1;
  const activeId = activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    if (open && activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeId]);

  const select = (model: CatalogModel) => {
    if (disabled || !model.supported_roles.includes(role)) return;
    onChange(model.id);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Popover.Root
        open={open && !disabled}
        onOpenChange={(next) => {
          setOpen(next);
          setSearch("");
          setActiveToken(null);
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            disabled={disabled}
            className="w-full min-w-0 justify-between font-normal"
          >
            <span className="truncate">
              {current?.name || value || "选择模型"}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            aria-label={`选择${label}`}
            className="z-50 flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-0 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchRef.current?.focus();
            }}
          >
            <div className="relative shrink-0 border-b p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                role="combobox"
                aria-label={`搜索${label}`}
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                autoComplete="off"
                placeholder="搜索模型名称或 ID…"
                className="pl-8"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveToken(null);
                  if (listRef.current) listRef.current.scrollTop = 0;
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (!selectable.length) return;
                    const index = active ? selectable.indexOf(active) : -1;
                    const next =
                      (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        selectable.length) %
                      selectable.length;
                    setActiveToken(token(selectable[next]));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (active) select(active);
                  }
                }}
              />
            </div>
            {!current && value && (
              <p className="shrink-0 break-all border-b px-3 py-2 text-xs text-muted-foreground">
                当前设置：{value} · 未在可选目录中确认
              </p>
            )}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              className="min-h-0 overflow-y-auto overscroll-contain p-1"
            >
              {filtered.map((m, index) => {
                const supported = m.supported_roles.includes(role);
                const selected = m === current;
                return (
                  <div
                    key={token(m)}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!supported}
                    onPointerMove={() => {
                      if (supported) setActiveToken(token(m));
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(m)}
                    className={`relative rounded-sm py-2 pr-8 pl-2 text-sm ${supported ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${m === active ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <span className="block break-words">{m.name}</span>
                    <span className="mt-1 block break-all text-[11px] text-muted-foreground">
                      {m.id}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {TEXT_PROVIDERS[m.provider]} ·{" "}
                      {m.permission === "authorized"
                        ? "已授权"
                        : "可见，权限待确认"}
                      {!supported ? ` · ${m.reason || "应用暂未适配"}` : ""}
                    </span>
                    {selected && (
                      <Check className="absolute top-3 right-2 size-4" />
                    )}
                  </div>
                );
              })}
              {!filtered.length && (
                <p role="status" className="p-3 text-xs text-muted-foreground">
                  {search
                    ? "没有匹配的模型，试试其他名称或 ID"
                    : "暂无此类模型，请配置服务并拉取列表"}
                </p>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {current && (
        <p className="break-all text-[11px] leading-5 text-muted-foreground">
          {current.id} ·{" "}
          {current.permission === "authorized"
            ? "已授权"
            : "可见，调用权限待确认"}
        </p>
      )}
    </div>
  );
}
