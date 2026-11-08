export type Json = Record<string, any>;
export type Status = "empty" | "draft" | "approved" | "stale";
export interface Version {
  id: string;
  number: number;
  content: Json;
  inputs: Json;
  approved?: boolean;
  source?: string;
  created: number;
  [key: string]: any;
}
export interface Stage {
  versions: Version[];
  selected: string | null;
}
export interface Run {
  id: string;
  name: string;
  model: string;
  planning_schema: number;
  finished_at?: number;
  production_snapshot?: ProductionSettings;
  created: number;
  steps: Record<string, Stage>;
  media: Record<string, Version[]>;
  media_selection: Record<string, string>;
  conversations: Record<string, Json[]>;
  exports: Json[];
  video_options?: Record<string, Json>;
  statuses?: Record<string, Status>;
  media_fresh?: Record<string, boolean>;
  current_export?: Json | null;
  [key: string]: any;
}
export interface Episode {
  locked_at?: number;
  id: string;
  title: string;
  brief: string;
  target_duration?: number;
  number: number;
  active_run: string;
  runs: Run[];
  created: number;
  [key: string]: any;
}
export interface Asset {
  id: string;
  /** Per-state editable definition and adopted media version. */
  draft_versions?: Record<string, string>;
  adopted_versions?: Record<string, string>;
  name: string;
  kind: string;
  selected: string | null;
  versions: Json[];
  [key: string]: any;
}
export interface ProductionSettings {
  style: string;
  ratio: string;
  prompt: string;
  adaptation: string;
  revision: number;
}
export interface Project {
  id: string;
  title: string;
  brief: string;
  production: ProductionSettings;
  assets: Asset[];
  episodes: Episode[];
  created: number;
  updated: number;
  [key: string]: any;
}
export interface Job extends Json {
  id: string;
  project_id: string;
  episode_id: string;
  run_id: string;
  kind: string;
  state: string;
  message: string;
  created: number;
}
export const STEPS = [
  "story",
  "director",
  "characters",
  "generation",
  "finish",
  "complete",
] as const;
export const TITLES: Record<string, string> = {
  story: "故事",
  director: "分镜与资源",
  characters: "分镜资源",
  generation: "视频生成",
  finish: "合成导出",
  complete: "结束方案",
};
export const PROFILES: Record<string, Json> = {
  "doubao-seedance-2-5-260628": {
    name: "Seedance 2.5",
    min: 4,
    max: 30,
    draft: true,
    provider: "seedance",
    extend: true,
  },
  "doubao-seedance-2-0-fast-260128": {
    name: "Seedance 2.0 Fast",
    min: 4,
    max: 15,
    draft: false,
    provider: "seedance",
    extend: true,
  },
  "doubao-seedance-2-0-260128": {
    name: "Seedance 2.0",
    min: 4,
    max: 15,
    draft: false,
    provider: "seedance",
    extend: true,
  },
  "wan2.6-t2v": {
    name: "万相 2.6 · 文生视频",
    min: 2,
    max: 15,
    provider: "wan",
    extend: false,
    image_mode: "text",
  },
  "wan2.6-i2v": {
    name: "万相 2.6 · 首帧视频",
    min: 2,
    max: 15,
    provider: "wan",
    extend: false,
    image_mode: "first_frame",
  },
  "wan2.6-i2v-flash": {
    name: "万相 2.6 Flash",
    min: 2,
    max: 15,
    provider: "wan",
    extend: false,
    image_mode: "first_frame",
  },
};
export const DEFAULT_EPISODE_DURATION = 60;
export const DEFAULT_MODEL = "doubao-seedance-2-5-260628";
