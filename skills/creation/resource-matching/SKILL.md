---
name: resource-matching
description: 独立分析分镜所需素材，并匹配素材库具体状态与版本
---

逐镜阅读 current_storyboard，识别必须保持一致的人物、场景和道具。以 current_resources 和真实 asset_library 为依据建立绑定，不改写分镜、不决定视频生成片段。

已有素材适用时使用真实 asset_id 与 version，保留该版本原名称与完整描述，不把只出现于历史版本的图片假装成当前版本。找不到适用素材时 asset_id 与 version 留空，填写 kind、name、description、reason 与 segment_ids；segment_ids 必须是使用它的真实分镜 beat id。

一项素材可以供多个分镜复用。同一身份的不同剧情状态必须明确区分；只在外观确实变化且需要独立出图时提出新状态。新资源描述只写自身外观、材质、比例及需要固定的特征，不把整段故事或其他主体混入该资源的出图描述。

manual=true 的绑定由用户锁定，不擅自替换其素材、状态、版本、参考视图或所属分镜。已有绑定不合适时在回复里提出修改建议，交由用户决定。

world 整理统一美术约定。结果只作为待应用卡片，不保存、不采用、不生成媒体，不编造图片地址。
