"use client";
import {
  Children,
  Fragment,
  isValidElement,
  createContext,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { createPortal } from "react-dom";

const ToolbarSlots = createContext<{
  meta: HTMLFieldSetElement | null;
  actions: HTMLFieldSetElement | null;
  locked: boolean;
  footer: HTMLDivElement | null;
} | null>(null);

// Each stage owns its state and handlers; only their DOM position moves into
// the fixed workspace header. Re-keying the workspace drops the old portals.
export function StageWorkspace({
  title,
  locked,
  children,
}: {
  title: string;
  locked: boolean;
  children: ReactNode;
}) {
  const [meta, setMeta] = useState<HTMLFieldSetElement | null>(null);
  const [actions, setActions] = useState<HTMLFieldSetElement | null>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <ToolbarSlots.Provider value={{ meta, actions, locked, footer }}>
      <section
        aria-label={`${title}工作区`}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
      >
        <div
          role="toolbar"
          aria-label={`${title}操作栏`}
          className="flex min-h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-2 [&_button]:shrink-0 [&_button]:h-8 [&_button]:text-xs [&_[data-slot=badge]]:px-1.5 [&_[data-slot=badge]]:text-[10px]"
        >
          <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
          <fieldset
            ref={setMeta}
            disabled={locked}
            aria-label={`${title}版本与状态`}
            className="flex min-w-0 shrink-0 items-center gap-1 border-0 p-0 [&_[data-slot=select-trigger]]:h-8 [&_[data-slot=select-trigger]]:px-2"
          />
          <fieldset
            ref={setActions}
            disabled={locked}
            aria-label={`${title}操作`}
            className="ml-auto flex shrink-0 items-center gap-1 border-0 p-0 [&>div]:flex-nowrap [&_button]:px-1.5"
          />
        </div>
        {children}
        <div
          ref={setFooter}
          className="shrink-0 border-t bg-card empty:hidden"
        />
      </section>
    </ToolbarSlots.Provider>
  );
}
export function StageToolbar({
  meta,
  children,
}: {
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const slots = useContext(ToolbarSlots);
  if (!slots)
    return (
      <div className="flex items-center justify-between gap-2">
        {meta}
        {children}
      </div>
    );
  return (
    <>
      {slots.meta && meta && createPortal(meta, slots.meta)}
      {slots.actions && children && createPortal(children, slots.actions)}
    </>
  );
}

// Footer content lives outside the workspace's scrolling content area.
export function StageFooter({ children }: { children: ReactNode }) {
  const slots = useContext(ToolbarSlots);
  if (!slots) return <div>{children}</div>;
  return slots.footer ? createPortal(children, slots.footer) : null;
}

type ActionElement = ReactElement<{ children?: ReactNode; disabled?: boolean }>;
function actionItems(children: ReactNode): ActionElement[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean }>(child))
      return [];
    return child.type === Fragment
      ? actionItems(child.props.children)
      : [child];
  });
}
export function StageMoreActions({ children }: { children: ReactNode }) {
  const slots = useContext(ToolbarSlots);
  return (
    <StageToolbar>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label="更多操作"
            title="更多操作"
            disabled={slots?.locked}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="flex w-52 flex-col gap-1 p-2 [&_button]:w-full [&_button]:justify-start"
        >
          {actionItems(children).map((child, index) => (
            <DropdownMenuItem
              key={child.key || index}
              asChild
              disabled={slots?.locked || child.props.disabled}
            >
              {child}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </StageToolbar>
  );
}
