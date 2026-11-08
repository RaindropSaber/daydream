import { STEPS } from "./types";

export type StudioView =
  | "home"
  | "models"
  | "overview"
  | "story-workspace"
  | "assets"
  | "jobs"
  | "episode";
export type NavigationParams = {
  project?: string;
  episode?: string;
  run?: string;
  step?: string;
  version?: string;
  asset?: string;
  state?: string;
};
export type StudioRoute = NavigationParams & { view: StudioView };
export const isStudioStep = (step: string) =>
  STEPS.some((candidate) => candidate === step);

/** Project and episode identify pages; run and version select content within them. */
export function studioPath(view: StudioView, params: NavigationParams = {}) {
  const segment = (key: "project" | "episode") => {
    const value = params[key];
    if (!value) throw new Error(`路由缺少 ${key}`);
    return encodeURIComponent(value);
  };
  if (view === "home") return "/";
  if (view === "models" && !params.project) return "/models";
  const project = `/projects/${segment("project")}`;
  switch (view) {
    case "overview":
      return project;
    case "assets": {
      const selection = new URLSearchParams();
      if (params.asset) selection.set("asset", params.asset);
      if (params.state) selection.set("state", params.state);
      return `${project}/assets${selection.size ? `?${selection}` : ""}`;
    }
    case "models":
    case "jobs":
      return `${project}/${view}`;
    case "story-workspace":
      return `${project}/stories`;
    case "episode": {
      if (params.step && !isStudioStep(params.step))
        throw new Error(`未知制作步骤：${params.step}`);
      const path = `${project}/episodes/${segment("episode")}${params.step ? `/${params.step}` : ""}`;
      const selection = new URLSearchParams();
      if (params.run) selection.set("run", params.run);
      if (params.version) selection.set("version", params.version);
      return selection.size ? `${path}?${selection}` : path;
    }
  }
}
