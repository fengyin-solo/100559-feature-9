import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta } from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

// 偏差处理的领域规则都收在这里：批量送调查、整组升级、逐级流转、质量复核、同步清洁验证。
// 页面只调用这里导出的函数，不在组件里写业务判断。

const meta = moduleMeta('deviation')
const CLEAN_KEY = 'cleanvalidate'

// 手册里既有的口径：偏差类型、严重程度，统一从模块字典取，页面不另造一份。
export const DEVIATION_TYPES: string[] = meta.dictionaries?.['偏差类型'] ?? []
export const SEVERITY_LEVELS: string[] = meta.dictionaries?.['严重程度'] ?? []

// 纠正措施的边界：超出这个长度范围就算越界，打回重填。
export const CAPA_MIN = 10
export const CAPA_MAX = 200

const STATUS = {
  todo: '待处理',
  investigating: '调查中',
  reviewing: '待复核',
  closed: '已关闭',
  escalated: '已升级',
} as const
const TERMINAL_STATUSES: string[] = [STATUS.closed, STATUS.escalated]

// 发生工序 → 责任车间：送调查时按工序自动分派。
const PROCESS_WORKSHOP: [string, string][] = [
  ['称量配料', '配料车间'],
  ['制粒', '固体制剂车间'],
  ['压片', '固体制剂车间'],
  ['包衣', '固体制剂车间'],
  ['灌装', '无菌灌装车间'],
  ['灭菌', '灭菌车间'],
  ['包装', '包装车间'],
  ['清洁', '洁净保障车间'],
]
const DEFAULT_WORKSHOP = '生产保障车间'

export function workshopFor(process: string): string {
  const hit = PROCESS_WORKSHOP.find(([keyword]) => process.includes(keyword))
  return hit ? hit[1] : DEFAULT_WORKSHOP
}

export type ReceiptKind = 'advanced' | 'held' | 'duplicate' | 'rejected'

export type ReceiptItem = {
  id: number
  code: string
  kind: ReceiptKind
  message: string
}

export type BatchReceipt = {
  action: string
  items: ReceiptItem[]
}

export type DeviationDraft = {
  偏差类型?: string
  严重程度?: string
  根本原因?: string
  纠正措施?: string
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function capaOutOfBounds(capa: string): boolean {
  const length = capa.trim().length
  return length < CAPA_MIN || length > CAPA_MAX
}

function withStatus(row: EntryRow, status: string): EntryRow {
  return {
    ...row,
    status,
    偏差状态: status,
    pending: !TERMINAL_STATUSES.includes(status),
    abnormal: status === STATUS.escalated ? true : row.abnormal,
  }
}

// 旧版本浏览器缓存里没有新字段，读出来时补齐默认值，免得页面和校验踩空。
export function ensureDeviationRows(): EntryRow[] {
  const rows = listRows(meta.key)
  let changed = false
  const next = rows.map((row) => {
    const patched = { ...row }
    for (const field of meta.fields) {
      if (!(field in patched)) {
        patched[field] = ''
        changed = true
      }
    }
    if (!SEVERITY_LEVELS.includes(String(patched['严重程度']))) {
      patched['严重程度'] = '一般'
      changed = true
    }
    if (isBlank(patched['责任车间']) && String(patched.status) !== STATUS.todo) {
      patched['责任车间'] = workshopFor(String(patched['发生工序'] ?? ''))
      changed = true
    }
    return patched
  })
  if (changed) {
    saveRows(meta.key, next)
  }
  return next
}

// 当前状态下允许执行的动作：终态没有动作，其余逐级给。
export function nextActionsFor(status: string): string[] {
  switch (status) {
    case STATUS.todo:
      return ['提交调查', '升级偏差']
    case STATUS.investigating:
      return ['送质量复核', '升级偏差']
    case STATUS.reviewing:
      return ['关闭偏差']
    default:
      return []
  }
}

// 单条送调查：批量和单点共用这一段，保证回执口径一致。
function assessSubmit(row: EntryRow): ReceiptItem {
  const id = Number(row.id)
  const code = String(row['偏差编号'] ?? `#${id}`)
  const status = String(row.status)
  if (status === STATUS.investigating) {
    return { id, code, kind: 'duplicate', message: '已在调查中，重复送审只算一次' }
  }
  if (status !== STATUS.todo) {
    return { id, code, kind: 'rejected', message: `当前状态「${status}」不能送调查` }
  }
  const missing: string[] = []
  const type = String(row['偏差类型'] ?? '').trim()
  if (isBlank(type)) {
    missing.push('偏差类型')
  }
  if (isBlank(row['根本原因'])) {
    missing.push('根本原因')
  }
  if (missing.length > 0) {
    return { id, code, kind: 'held', message: `缺${missing.join('、')}，先放一边，补录后再送` }
  }
  if (!DEVIATION_TYPES.includes(type)) {
    return { id, code, kind: 'held', message: '偏差类型不在手册口径内，先放一边，改用手册口径后再送' }
  }
  return { id, code, kind: 'advanced', message: '' }
}

// 批量送调查：同一偏差编号重复出现只算第一次，缺项的搁置，其余照常推进并分派责任车间。
export function submitForInvestigation(ids: number[]): BatchReceipt {
  const rows = ensureDeviationRows()
  const current = new Map(rows.map((row) => [Number(row.id), row]))
  const seenCodes = new Set<string>()
  const items: ReceiptItem[] = []

  for (const id of ids) {
    const row = current.get(id)
    if (!row) {
      items.push({ id, code: `#${id}`, kind: 'rejected', message: '没有找到这条偏差记录' })
      continue
    }
    const code = String(row['偏差编号'] ?? `#${id}`)
    if (seenCodes.has(code)) {
      items.push({ id, code, kind: 'duplicate', message: '同一偏差编号重复送审，只算一次' })
      continue
    }
    seenCodes.add(code)

    const verdict = assessSubmit(row)
    if (verdict.kind !== 'advanced') {
      items.push(verdict)
      continue
    }
    const workshop = workshopFor(String(row['发生工序'] ?? ''))
    const updated = withStatus({ ...row, 责任车间: workshop }, STATUS.investigating)
    current.set(id, updated)
    items.push({ id, code, kind: 'advanced', message: `已送调查，按发生工序分派至${workshop}` })
  }

  saveRows(meta.key, [...current.values()])
  return { action: '批量送调查', items }
}

// 整组升级：只有严重偏差能随组升级，其余逐条挡回并说明原因。
export function escalateBatch(ids: number[]): BatchReceipt {
  const rows = ensureDeviationRows()
  const current = new Map(rows.map((row) => [Number(row.id), row]))
  const seenCodes = new Set<string>()
  const items: ReceiptItem[] = []

  for (const id of ids) {
    const row = current.get(id)
    if (!row) {
      items.push({ id, code: `#${id}`, kind: 'rejected', message: '没有找到这条偏差记录' })
      continue
    }
    const code = String(row['偏差编号'] ?? `#${id}`)
    if (seenCodes.has(code)) {
      items.push({ id, code, kind: 'duplicate', message: '同一偏差编号重复提交，只算一次' })
      continue
    }
    seenCodes.add(code)

    const status = String(row.status)
    if (status === STATUS.escalated) {
      items.push({ id, code, kind: 'duplicate', message: '已经升级过，不重复操作' })
      continue
    }
    if (status === STATUS.closed) {
      items.push({ id, code, kind: 'rejected', message: '已关闭的偏差不再升级' })
      continue
    }
    if (String(row['严重程度']) !== '严重') {
      items.push({ id, code, kind: 'rejected', message: '非严重偏差，不随整组升级，请按常规流程推进' })
      continue
    }
    current.set(id, withStatus(row, STATUS.escalated))
    items.push({ id, code, kind: 'advanced', message: '已随整组升级为「已升级」' })
  }

  saveRows(meta.key, [...current.values()])
  return { action: '整组升级', items }
}

// 偏差关闭后把结果同步到清洁验证待办：按偏差编号幂等，纠正措施与偏差记录保持同一份。
function syncToCleanValidate(row: EntryRow): void {
  const list = listRows(CLEAN_KEY)
  const code = String(row['偏差编号'] ?? '')
  const verifyCode = `CLEA-${code}`
  const payload: Record<string, string | boolean> = {
    验证编号: verifyCode,
    设备名称: String(row['发生工序'] ?? ''),
    清洁规程: String(row['纠正措施'] ?? ''),
    取样点: String(row['责任车间'] ?? ''),
    检测结果: '待检',
    验证人: String(row['责任人'] ?? ''),
    验证状态: '待验证',
    来源偏差: code,
  }
  const index = list.findIndex((item) => String(item['验证编号']) === verifyCode)
  if (index >= 0) {
    // 已同步过的只刷新内容（纠正措施等），不动清洁验证自己的进度与状态。
    list[index] = { ...list[index], ...payload }
  } else {
    const nextId = list.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
    list.push({
      id: nextId,
      status: '待验证',
      pending: true,
      abnormal: false,
      残留限度: '按规程执行',
      ...payload,
    } as EntryRow)
  }
  saveRows(CLEAN_KEY, list)
}

// 清洁验证页用的待办视图：从偏差同步过来、还没验证完的记录。
export function listSyncedCleanTodos(): EntryRow[] {
  return listRows(CLEAN_KEY).filter(
    (row) => !isBlank(row['来源偏差']) && String(row.status) !== '已验证',
  )
}

// 单条动作：逐级推进，越级挡回；关闭前必须过质量部复核，结论同步清洁验证。
export function advanceDeviation(id: number, action: string): ActionResult {
  const rows = ensureDeviationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  const row = rows[index]
  const code = String(row['偏差编号'] ?? `#${id}`)

  if (action === '升级偏差') {
    const receipt = escalateBatch([id])
    const item = receipt.items[0]
    return { ok: item.kind === 'advanced', message: `${code}：${item.message}` }
  }

  if (action === '提交调查') {
    const receipt = submitForInvestigation([id])
    const item = receipt.items[0]
    return { ok: item.kind === 'advanced' || item.kind === 'duplicate', message: `${code}：${item.message}` }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `偏差记录没有登记「${action}」这个动作` }
  }
  const from = meta.statuses.indexOf(String(row.status))
  const to = meta.statuses.indexOf(target)
  if (to !== from + 1) {
    return { ok: false, message: `${code}：状态只能逐级推进，「${row.status}」不能越级到「${target}」` }
  }

  if (action === '送质量复核') {
    const capa = String(row['纠正措施'] ?? '')
    if (isBlank(capa)) {
      return { ok: false, message: `${code}：还没有纠正措施，先补录再送质量部复核` }
    }
    if (capaOutOfBounds(capa)) {
      return { ok: false, message: `${code}：纠正措施越界（需 ${CAPA_MIN}–${CAPA_MAX} 字），打回重填` }
    }
  }

  const updated = withStatus(row, target)
  const next = [...rows]
  next[index] = updated
  saveRows(meta.key, next)

  if (action === '关闭偏差') {
    syncToCleanValidate(updated)
    return { ok: true, message: `${code}：质量部复核通过，偏差已关闭，结果已同步清洁验证待办` }
  }
  return { ok: true, message: `${code}：已${action}，当前状态「${target}」` }
}

// 补录/修改：偏差类型沿手册口径，纠正措施越界打回重填；终态记录不再允许改动。
export function saveDeviationDraft(id: number, draft: DeviationDraft): ActionResult {
  const rows = ensureDeviationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  const row = rows[index]
  const code = String(row['偏差编号'] ?? `#${id}`)
  if (TERMINAL_STATUSES.includes(String(row.status))) {
    return { ok: false, message: `${code}：已${row.status}，不能再改动` }
  }
  if (draft.偏差类型 !== undefined && !DEVIATION_TYPES.includes(draft.偏差类型)) {
    return { ok: false, message: `${code}：偏差类型须沿用手册口径（${DEVIATION_TYPES.join('、')}）` }
  }
  if (draft.严重程度 !== undefined && !SEVERITY_LEVELS.includes(draft.严重程度)) {
    return { ok: false, message: `${code}：严重程度须沿用手册口径（${SEVERITY_LEVELS.join('、')}）` }
  }
  if (draft.纠正措施 !== undefined && !isBlank(draft.纠正措施) && capaOutOfBounds(draft.纠正措施)) {
    return { ok: false, message: `${code}：纠正措施越界（需 ${CAPA_MIN}–${CAPA_MAX} 字），打回重填` }
  }

  const patched: EntryRow = { ...row }
  for (const [field, value] of Object.entries(draft)) {
    if (value !== undefined) {
      patched[field] = value.trim()
    }
  }
  const next = [...rows]
  next[index] = patched
  saveRows(meta.key, next)
  return { ok: true, message: `${code}：已保存` }
}
