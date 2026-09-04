# ⛓️ Sequence Forge

**Build. Flow. Recover.**

一个 PWA 健身训练编排器，支持自定义动作相位（up/hold/down）、拖拽搭建训练流程、实时呼吸红圈引导和离线使用。

---

## 核心特性

- **项目（Project）**：定义动作的相位序列（如 `down 2s → hold 1s → up 1s`），附带配图和默认备注。
- **训练组（Routine）**：按时间线编排项目，自动插入 5 分钟恢复块，支持组循环、组间短歇、组间大休。
- **训练执行**：四分位布局（红圈右下），实时显示配图、倒计时、相位名称和备注。
- **音频引导**：`up` 升调滑音，`down` 降调滑音，`hold` 每秒滴答声。
- **数据持久化**：IndexedDB 存储，支持导出为单个 JSON（图片 Base64 内嵌）。
- **离线 PWA**：Service Worker 缓存，PC/Android/iOS 均可安装。

---

## 文件结构
