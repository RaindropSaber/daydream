export type AssetImageSpec = {
  pose: string;
  label: string;
  summary: string;
  direction: string;
};

const specs: Record<string, AssetImageSpec> = {
  character: {
    pose: "character-sheet",
    label: "角色四视图",
    summary: "生成 1 张角色设定图：正面、侧面、背面全身及半身特写。",
    direction:
      "一张1:1正方形角色设定板，采用清晰的2×2四区布局：左上为正面全身，右上为严格90度侧面全身，左下为背面全身，右下为正面半身特写。前三个全身视图必须从头到脚完整入镜、脚底留白，站姿自然且缩放一致；半身特写从头顶到腰部，清晰展示面部和上身细节。四区展示同一个角色的不同视图，面容、身体比例、服装、配色、材质和结构完全一致，绝非四个角色。统一中性纯灰背景、均匀光照，各区留足间距，轮廓不重叠。不出现其他角色、道具或剧情场景，不添加分隔线、文字、标签或标注。只输出一张包含全部四个视图的图片，不分别输出多张图片",
  },
  scene: {
    pose: "establishing",
    label: "场景全景图",
    summary: "生成 1 张场景空间全景图。",
    direction:
      "一张16:9场景空间全景图，清晰呈现完整空间布局、主要地标、建筑设施、材质与光线。只绘制空场景及场景固定设施，移除所有人物、机器人、动物与手持道具，不复现剧情动作。单一连续画面，不生成额外的细节图，不要拼图、分栏、文字或标注",
  },
  prop: {
    pose: "object",
    label: "道具设定图",
    summary: "生成 1 张道具设定图：完整三分之四视角。",
    direction:
      "关键道具单独展示，完整三分之四视角，呈现结构、比例与材质，中性纯灰背景；画面只有该道具，不出现持有者、人物、机器人、其他道具、街景或剧情动作。单张图片，不要拼图、分栏、文字或标注",
  },
};

export function assetImageSpec(kind: string): AssetImageSpec | undefined {
  return Object.hasOwn(specs, kind) ? specs[kind] : undefined;
}
