"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { Json, Project, Run, Episode, Job } from "@/lib/types";
export async function api(path: string, body?: Json) {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}
type Confirmation = {
  title: string;
  description: string;
  label?: string;
  action: () => void | Promise<void>;
};
type Context = {
  project: Project | null;
  episode: Episode | undefined;
  run: Run | undefined;
  jobs: Job[];
  config: Json;
  profiles: Json;
  refresh: () => Promise<void>;
  mutate: (action: string, body?: Json) => Promise<Json>;
  navigate: (view: string, params?: Json) => void;
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  confirm: (value: Confirmation) => void;
};
export const StudioContext = createContext<Context>(null!);
export const useStudio = () => useContext(StudioContext);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmContext.Provider value={setValue}>
      {children}
      <AlertDialog
        open={!!value}
        onOpenChange={(open) => {
          if (!open && !busy) setValue(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{value?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {value?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await value?.action();
                  setValue(null);
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "操作失败",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "处理中…" : value?.label || "确定"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
const ConfirmContext = createContext<(value: Confirmation) => void>(() => {});
export const useConfirm = () => useContext(ConfirmContext);
export function useAction() {
  const [busy, setBusy] = useState(false);
  const action = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await fn();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "请求失败");
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, action };
}
export function useUnsaved(dirty: boolean) {
  const { setDirty } = useStudio();
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
}
