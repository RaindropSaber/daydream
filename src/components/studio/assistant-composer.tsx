"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AtSign,
  BookOpen,
  Boxes,
  Sparkles,
  Send,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CREATION_SKILLS } from "@/lib/creation-flow";
import {
  MENTION_PATTERN,
  mentionQuery,
  type MentionOption,
} from "@/lib/assistant-mentions";

// Store readable tokens, render only DOM text and atomic chips. No HTML from users.
function editorText(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.editorEnd) return "";
  if (
    node instanceof HTMLElement &&
    node.getAttribute("role") === "textbox" &&
    node.childNodes.length === 1 &&
    node.firstChild?.nodeName === "BR"
  )
    return "";
  if (node instanceof HTMLElement && node.dataset.token)
    return node.dataset.token;
  if (node.nodeName === "BR") return "\n";
  return (
    Array.from(node.childNodes)
      .map(
        (child, i) =>
          (i && ["DIV", "P"].includes(child.nodeName) ? "\n" : "") +
          editorText(child),
      )
      .join("") ||
    node.textContent ||
    ""
  );
}
function caretOffset(root: HTMLElement, edge: "start" | "end" = "end") {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode))
    return editorText(root).length;
  const range = selection.getRangeAt(0).cloneRange();
  const container =
    edge === "start" ? range.startContainer : range.endContainer;
  const offset = edge === "start" ? range.startOffset : range.endOffset;
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return editorText(range.cloneContents()).length;
}
function moveCaret(root: HTMLElement, offset: number) {
  const range = document.createRange();
  let remaining = offset;
  let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node instanceof HTMLElement && node.dataset.token) {
      const length = node.dataset.token.length;
      if (remaining <= length) {
        if (remaining === 0) range.setStartBefore(node);
        else range.setStartAfter(node);
        found = true;
      } else remaining -= length;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        found = true;
      } else remaining -= length;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  if (!found) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function AssistantComposer({
  value,
  onChange,
  onSend,
  disabled,
  waiting,
  options,
  focusKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  waiting: boolean;
  options: MentionOption[];
  focusKey: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const lastValue = useRef("");
  const composing = useRef(false);
  const savedCaret = useRef(value.length);
  const [query, setQuery] = useState<ReturnType<typeof mentionQuery>>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = query
    ? options.filter((o) =>
        `${o.label} ${o.token} ${o.description}`
          .toLowerCase()
          .includes(query.query.toLowerCase()),
      )
    : [];
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  const render = (text: string) => {
    const root = editor.current;
    if (!root) return;
    root.replaceChildren();
    let end = 0;
    for (const match of text.matchAll(new RegExp(MENTION_PATTERN))) {
      root.append(document.createTextNode(text.slice(end, match.index)));
      const option = options.find((o) => o.token === match[0]);
      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.dataset.token = match[0];
      chip.className =
        "mx-0.5 inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 align-baseline text-xs font-medium text-primary select-none";
      const label =
        option?.label ||
        (match[1] === "skill" && Object.hasOwn(CREATION_SKILLS, match[2])
          ? CREATION_SKILLS[match[2] as keyof typeof CREATION_SKILLS].title
          : match[2]);
      const name = document.createElement("span");
      name.textContent = `${match[1] === "skill" ? "✦ " : "@"}${label}`;
      chip.title = `${match[1] === "skill" ? "Skill" : "引用"} · ${match[2]}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.tabIndex = -1;
      remove.className =
        "rounded px-0.5 text-primary/60 hover:bg-primary/10 hover:text-primary";
      remove.setAttribute("aria-label", `移除${label}`);
      remove.textContent = "×";
      remove.onmousedown = (e) => e.preventDefault();
      remove.onclick = () => {
        if (root.getAttribute("contenteditable") !== "true") return;
        chip.remove();
        const next = editorText(root);
        lastValue.current = next;
        onChange(next);
        setQuery(null);
        root.focus();
      };
      chip.append(name, remove);
      root.append(chip);
      end = match.index! + match[0].length;
    }
    root.append(document.createTextNode(text.slice(end)));
    if (text.endsWith("\n")) {
      const end = document.createElement("br");
      end.dataset.editorEnd = "true";
      root.append(end);
    }
  };
  useEffect(() => {
    if (lastValue.current !== value || !editor.current?.childNodes.length) {
      render(value);
      lastValue.current = value;
    }
  }, [value, options]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setQuery(null);
    if (!disabled) {
      editor.current?.focus();
      if (editor.current) moveCaret(editor.current, value.length);
    }
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (query)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, query, listId]);

  const read = () => {
    if (!editor.current || composing.current) return;
    const text = editorText(editor.current);
    const caret = caretOffset(editor.current);
    savedCaret.current = caret;
    lastValue.current = text;
    onChange(text);
    const next = mentionQuery(text, caret);
    setQuery(next);
    setActive(0);
  };
  const insert = (text: string, start: number, end: number) => {
    const next = value.slice(0, start) + text + value.slice(end);
    if (next.length > 12000) return;
    render(next);
    lastValue.current = next;
    onChange(next);
    const caret = start + text.length;
    savedCaret.current = caret;
    editor.current?.focus();
    if (editor.current) moveCaret(editor.current, caret);
  };
  const choose = (option: MentionOption) => {
    if (!query) return;
    insert(`${option.token} `, query.start, query.end);
    setQuery(null);
  };
  const openMentions = () => {
    const caret = savedCaret.current;
    const prefix = caret && !/\s/.test(value[caret - 1]) ? " @" : "@";
    insert(prefix, caret, caret);
    setQuery({
      start: caret + prefix.length - 1,
      end: caret + prefix.length,
      query: "",
    });
    setActive(0);
  };
  return (
    <div className="relative rounded-xl border bg-background p-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
      {query && !disabled && (
        <div className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-xl border bg-popover shadow-xl">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            引用 skill 或项目内容
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="引用候选"
            className="max-h-64 overflow-y-auto p-1"
          >
            {matches.length ? (
              matches.map((option, index) => {
                const Icon =
                  option.kind === "skill"
                    ? Sparkles
                    : option.kind === "stage"
                      ? BookOpen
                      : Boxes;
                return (
                  <button
                    key={option.token}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                    onMouseEnter={() => setActive(index)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left ${index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {option.kind === "skill"
                        ? "Skill"
                        : option.kind === "stage"
                          ? "环节"
                          : "资源"}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                没有匹配项，试试“故事”或“story”
              </p>
            )}
          </div>
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            ↑↓ 选择 · Enter / Tab 插入 · Esc 关闭
          </div>
        </div>
      )}
      <div
        ref={editor}
        role="textbox"
        aria-label="创作消息"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={!!query && !disabled}
        aria-controls={query ? listId : undefined}
        aria-activedescendant={
          query && matches.length ? `${listId}-${activeIndex}` : undefined
        }
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={
          disabled ? "暂时无法输入" : "输入消息，@ 引用 skill 或内容…"
        }
        className="max-h-44 min-h-16 overflow-y-auto whitespace-pre-wrap break-words px-1 py-1.5 text-sm leading-7 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        onInput={read}
        onClick={read}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          read();
        }}
        onCopy={(e) => {
          const selection = window.getSelection();
          if (!selection?.rangeCount) return;
          e.preventDefault();
          e.clipboardData.setData(
            "text/plain",
            editorText(selection.getRangeAt(0).cloneContents()),
          );
        }}
        onPaste={(e) => {
          e.preventDefault();
          const sel = window.getSelection();
          if (editor.current && sel?.rangeCount) {
            const start = caretOffset(editor.current, "start");
            const selected = caretOffset(editor.current, "end") - start;
            insert(
              e.clipboardData
                .getData("text/plain")
                .slice(0, Math.max(0, 12000 - value.length + selected)),
              start,
              start + selected,
            );
            setQuery(null);
          }
        }}
        onKeyDown={(e) => {
          if (
            e.nativeEvent.isComposing ||
            composing.current ||
            e.keyCode === 229
          )
            return;
          if (query) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
            if (
              (e.key === "ArrowDown" || e.key === "ArrowUp") &&
              matches.length
            ) {
              e.preventDefault();
              setActive(
                (activeIndex +
                  (e.key === "ArrowDown" ? 1 : -1) +
                  matches.length) %
                  matches.length,
              );
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              if (matches.length) choose(matches[activeIndex]);
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey && editor.current) {
              const caret = caretOffset(editor.current);
              insert("\n", caret, caret);
            } else onSend();
          }
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            requestAnimationFrame(read);
          if (
            value.length >= 12000 &&
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey
          )
            e.preventDefault();
        }}
      />
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
          aria-label="添加引用"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openMentions}
        >
          <AtSign className="size-3.5" />
          引用
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            Shift + Enter 换行
          </span>
          <Button
            type="button"
            size="icon"
            className="size-8 rounded-lg"
            aria-label="发送"
            title="发送（Enter）"
            disabled={disabled || !value.trim()}
            onClick={onSend}
          >
            {waiting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
