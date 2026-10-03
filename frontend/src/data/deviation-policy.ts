// 偏差处理手册口径（《偏差处理管理规程》SOP-QA-DEV-001）：
// 偏差类型、纠正措施可选范围、工序到责任车间的分派都以本文件为准，
// 页面与本地数据层不允许另造枚举，新增/送审时不在口径内的一律挡回。

export const DEVIATION_KEY = 'deviation'

// 手册规定的偏差类型：重大、主要、次要三级。
export const DEVIATION_TYPES = ['重大偏差', '主要偏差', '次要偏差'] as const

// 偏差状态单向推进：
// 待处理 → 调查中 → 待质量复核 → 已关闭；重大偏差可从任一非终态整组升级到「已升级」（终态）。
// 越级操作（比如待处理直接送复核、直接关闭）一律挡回。
export const DEVIATION_STATUSES = ['待处理', '调查中', '待质量复核', '已关闭', '已升级'] as const

export const DEVIATION_TERMINAL_STATUSES = ['已关闭', '已升级'] as const

// 手册允许直接落地的纠正措施。越界（自拟、空白、夹带别的内容）一律打回重填。
export const CORRECTIVE_ACTION_CATALOG = [
  '重新清洁',
  '设备再验证',
  '人员再培训',
  '修订清洁规程',
  '增加监测频次',
  '隔离受影响批次',
  '设备维护检修',
  '加强清场复核',
] as const

// 发生工序 → 责任车间：按先具体后宽泛的顺序匹配，命中即分派；都不命中则挂综合生产车间待人工指派。
const WORKSHOP_RULES: { match: RegExp; workshop: string }[] = [
  { match: /灌装|冻干|轧盖|灌装线/, workshop: '灌装车间' },
  { match: /配液|配制|配料|称量/, workshop: '配液车间' },
  { match: /灭菌|除菌过滤/, workshop: '灭菌车间' },
  { match: /制粒|压片|包衣|总混|颗粒|片剂|胶囊/, workshop: '固体制剂车间' },
  { match: /洗瓶|安瓿|西林瓶|隧道烘箱/, workshop: '洗瓶车间' },
  { match: /包装|贴签|装盒/, workshop: '包装车间' },
  { match: /入库|取样|发料|仓储/, workshop: '仓储车间' },
  { match: /清洁|清场|洁净|环境监测/, workshop: '洁净区管理车间' },
]

export const FALLBACK_WORKSHOP = '综合生产车间（待人工指派）'

export function assignWorkshop(processStep: string): string {
  const step = String(processStep ?? '').trim()
  const hit = WORKSHOP_RULES.find((rule) => rule.match.test(step))
  return hit ? hit.workshop : FALLBACK_WORKSHOP
}

// 影响清洁验证的工序：这类偏差经质量部复核通过后，要在清洁验证页挂一条待办。
const CLEANING_RELATED = /清洁|清场|灌装|配液|洗瓶|环境监测/

export function isCleaningRelated(processStep: string): boolean {
  return CLEANING_RELATED.test(String(processStep ?? ''))
}

// 工序到清洁验证设备名称的默认推断，仅用于自动挂待办；页面上仍可按实际设备修订。
const EQUIPMENT_RULES: { match: RegExp; equipment: string }[] = [
  { match: /配液|配制/, equipment: '配液罐' },
  { match: /灌装/, equipment: '灌装机' },
  { match: /洗瓶/, equipment: '洗瓶机' },
  { match: /灭菌/, equipment: '灭菌柜' },
  { match: /清场|清洁/, equipment: '清洁间通用设备' },
]

export function inferEquipment(processStep: string): string {
  const step = String(processStep ?? '').trim()
  return EQUIPMENT_RULES.find((rule) => rule.match.test(step))?.equipment ?? '关联设备待确认'
}

export function isKnownDeviationType(value: string): boolean {
  return (DEVIATION_TYPES as readonly string[]).includes(String(value ?? '').trim())
}

export function isAllowedAction(value: string): boolean {
  return (CORRECTIVE_ACTION_CATALOG as readonly string[]).includes(String(value ?? '').trim())
}

export function textOf(value: unknown): string {
  return String(value ?? '').trim()
}
