---
name: settings
description: 从已确认故事与导演方案整理完整设定集
---

# 设定集整理

基于项目规范、已确认故事与导演方案整理 world 和 characters。world 包含 premise、technology、visual_language、palette、materials、avoid。提取重要人物、场景和关键道具，过滤普通路人和无关杂物，合并同一场景。人物外貌服装、场景布局材质与道具结构应具体可见。保留已有条目的真实 asset_id、version、kind，新增 ID 和版本留空字符串。segment_ids 仅引用实际出现的有效片段。视觉改变才标 appearance_changed=true，其他改动为 false。仅补充视觉细节，不增加剧情、能力或武器。不编造图片地址、不生图、不保存或采用版本。需要修改时调用对应工具，讨论时只回复。

同一资源允许并存多个剧情状态。人物换装、场景昼夜或损毁用 new_state=true，并填写 state_name、tags，保留来源 asset_id 与 version；segment_ids 仅包含使用新状态的片段，并保留其他片段的原状态。同一资源在一个片段只能出现一个状态。修正当前状态使用 new_state=false，并保留其版本引用。

## 读取上下文与状态

先用 get_workflow_status 确认 story、director 为 approved；分别用 get_stage_content 读取 story、director、characters，理解完整剧情、片段和已有设定，再用 get_project_assets 查真实资源与版本。以有效已确认的上游为依据，保留当前表单未保存修改，未确认或失效时先说明问题。

读取工具仅限当前项目；episode_id/run_id 只能使用目录中真实的 ID，省略时读取当前方案。get_stage_content 的 stage 可取 story、director、characters、generation、finish、complete；每次指定一个 stage，需要多项时依次调用。empty=无内容，draft=未确认，approved=有效已确认，stale=依据已变化、需复核。selected_version 只是选中稿，approved_version 才是当前有效已确认稿；latest_draft 不能自动覆盖已确认稿。历史版本用 version_id 明确读取，不混用不同方案。

生成前先查目标进度和必要上游，在本次工具执行器的读取次数上限内查阅，之后至多一次修改调用。读取的已保存内容不能覆盖 current_form/local_context 中用户尚未保存的编辑；两者冲突时优先保留用户最新编辑，并说明取舍。需要的项目资料应自行读取；资料确实为空时用合理假设创作第一版，不用提问阻塞。不得把创作假设说成已有内容，不得虚构状态、资源ID、媒体地址或已完成任务。模块入口的修改工具仅产生待应用卡片，用户应用后还需保存/确认；跨阶段对话若开放 save_stage_draft 则只保存待确认草稿，不改变已确认版本。
