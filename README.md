# 制药企业洁净区与批生产记录管理平台

面向洁净区环境监测、批生产记录编录、物料放行、偏差与变更控制、灭菌与清洁验证、成品检验与年度质量回顾的一体化药品生产质量管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 批生产记录 | `batchrecord` | 批生产记录 | 批号、产品名称、生产工序 |
| 洁净区环境监测 | `cleanroom` | 环境监测记录 | 监测点位、洁净级别、悬浮粒子数 |
| 物料放行 | `materialrelease` | 物料放行单 | 物料批号、物料名称、供应商 |
| 偏差处理 | `deviation` | 偏差记录 | 偏差编号、偏差类型、发生工序 |
| 变更控制 | `changecontrol` | 变更申请 | 变更编号、变更类别、涉及工序 |
| 清洁验证 | `cleanvalidate` | 清洁验证记录 | 验证编号、设备名称、清洁规程 |
| 灭菌验证 | `sterilize` | 灭菌验证记录 | 验证编号、灭菌设备、灭菌程序 |
| 培养基模拟灌装 | `mediafill` | 模拟灌装记录 | 灌装编号、灌装规格、灌装批量 |
| 工艺用水监测 | `watermonitor` | 水质监测记录 | 取样点、水系统类别、电导率 |
| 更衣确认 | `gowning` | 更衣确认记录 | 确认编号、洁净级别、更衣步骤 |
| 成品检验 | `finishedqc` | 成品检验报告 | 检验编号、产品批号、检验项目 |
| 留样管理 | `retainsample` | 留样记录 | 留样编号、对应批号、留样数量 |
| 稳定性考察 | `stability` | 稳定性考察记录 | 考察编号、考察批号、考察条件 |
| 产品召回 | `recall` | 召回记录 | 召回编号、涉及批号、召回级别 |
| 供应商审计 | `supplieraudit` | 供应商审计记录 | 审计编号、供应商名称、物料类别 |
| 人员培训 | `training` | 培训记录 | 培训编号、培训主题、受训岗位 |
| 年度质量回顾 | `annualreview` | 年度回顾报告 | 回顾编号、回顾年度、涉及产品 |
| 质量投诉 | `complaint` | 投诉记录 | 投诉编号、投诉来源、涉及产品 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 偏差模块按手册口径执行：
  - 偏差类型只允许「重大偏差 / 主要偏差 / 次要偏差」，纠正措施只能选自措施清单
    （见 `frontend/src/data/deviation-policy.ts`），越界一律打回重填。
  - 状态单向推进：待处理 → 调查中 → 待质量复核 → 已关闭；重大偏差可从任一非终态整组升级到「已升级」，越级挡回。
  - 勾选多条可批量送调查：逐条出回执，缺偏差类型/根本原因的先「暂缓」并单独提示；同一条偏差编号重复送审只算一次。
  - 送调查时按发生工序分派责任车间；调查结论须经质量部复核通过才关闭。
  - 影响清洁验证的偏差复核通过后，自动同步到清洁验证页的「偏差联动待办」，纠正措施实时取自偏差台账，两处一致。
- 想回到初始数据：清掉浏览器里 `pharma-cleanroom:entries`、`pharma-cleanroom:clean-deviation-todos`
  两项，或调用 `resetModule(模块)`。
