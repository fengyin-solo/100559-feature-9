/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 批量动作的逐条回执：accepted 已受理推进，held 资料不齐先放一边，rejected 越级/越界被挡回。
export type ReceiptKind = 'accepted' | 'held' | 'rejected'

export type BatchReceipt = {
  id: number
  code: string
  kind: ReceiptKind
  message: string
}

export type BatchActionResult = ActionResult & {
  accepted: BatchReceipt[]
  held: BatchReceipt[]
  rejected: BatchReceipt[]
}

// 清洁验证页的偏差联动待办：纠正措施等字段实时关联偏差台账，不做快照。
export type CleanTodoView = EntryRow & {
  来源偏差编号: string
  设备名称: string
  取样点: string
  关联工序: string
  待办状态: string
  创建日期: string
  纠正措施: string
  偏差类型: string
  偏差状态: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
