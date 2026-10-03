import { MODULE_BY_KEY } from '@/data/modules'
import {
  DEVIATION_KEY,
  DEVIATION_STATUSES,
  DEVIATION_TERMINAL_STATUSES,
  assignWorkshop,
  inferEquipment,
  isAllowedAction,
  isCleaningRelated,
  isKnownDeviationType,
  textOf,
} from '@/data/deviation-policy'
import {
  allRows,
  listCleanTodos,
  listRows,
  resetRows,
  saveCleanTodos,
  saveRows,
  type CleanTodoRecord,
} from '@/data/local-store'
import type {
  ActionResult,
  BatchActionResult,
  BatchReceipt,
  CleanTodoView,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 偏差模块有自己的单向流转与批量规则，走通用动作会绕过校验，这里直接挡回。
  if (key === DEVIATION_KEY) {
    return { ok: false, message: '偏差处理请使用偏差台账的专用操作（送调查 / 送复核 / 质量复核 / 升级）' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ── 偏差处理专用规则（手册口径，状态单向推进 + 批量送审）────────────────────

const deviationMeta = MODULE_BY_KEY.get(DEVIATION_KEY)!
const STATUS_INDEX: Record<string, number> = Object.fromEntries(
  [...DEVIATION_STATUSES].map((status, index) => [status, index]),
)
const TERMINAL = new Set<string>(DEVIATION_TERMINAL_STATUSES)

function deviationRows(): EntryRow[] {
  return listRows(DEVIATION_KEY)
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status)
}

function makeReceipt(row: EntryRow, kind: BatchReceipt['kind'], message: string): BatchReceipt {
  return { id: Number(row.id), code: textOf(row['偏差编号']), kind, message }
}

function summarizeBatch(action: string, accepted: BatchReceipt[], held: BatchReceipt[], rejected: BatchReceipt[]): string {
  const parts = [`${action}：受理 ${accepted.length} 条`]
  if (held.length) {
    parts.push(`暂缓 ${held.length} 条（补齐偏差类型/根本原因后再送）`)
  }
  if (rejected.length) {
    parts.push(`挡回 ${rejected.length} 条`)
  }
  return parts.join('，')
}

type BatchOutcome = {
  accepted: BatchReceipt[]
  held: BatchReceipt[]
  rejected: BatchReceipt[]
}

// 清洁验证联动：复核通过的清洁相关偏差挂一条待办，按偏差编号幂等。
function syncCleaningTodo(row: EntryRow): void {
  if (!isCleaningRelated(textOf(row['发生工序']))) {
    return
  }
  const code = textOf(row['偏差编号'])
  const todos = listCleanTodos()
  if (todos.some((todo) => todo.来源偏差编号 === code)) {
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  const next: CleanTodoRecord = { 来源偏差编号: code, 待办状态: '待办', 创建日期: today }
  saveCleanTodos([...todos, next])
}

// 逐条校验并落库；同批里相同偏差编号只受理一次。
export function batchDeviationAction(ids: number[], action: string): BatchActionResult {
  const rows = deviationRows()
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const outcome: BatchOutcome = { accepted: [], held: [], rejected: [] }
  const seenCodes = new Set<string>()
  const touched = new Map<number, EntryRow>()

  for (const id of ids) {
    const row = byId.get(id)
    if (!row) {
      outcome.rejected.push({ id, code: '—', kind: 'rejected', message: `没有找到编号为 ${id} 的偏差记录` })
      continue
    }
    const code = textOf(row['偏差编号'])
    const status = String(row.status)

    if (seenCodes.has(code)) {
      outcome.rejected.push(makeReceipt(row, 'rejected', `偏差编号 ${code} 本批已送审过一次，重复送审不再受理`))
      continue
    }

    let updated: EntryRow | null = null

    if (action === '提交调查') {
      if (isTerminalStatus(status) || STATUS_INDEX[status] > STATUS_INDEX['待处理']) {
        outcome.rejected.push(makeReceipt(row, 'rejected', `当前「${status}」，不能再送调查（状态单向推进，越级/重复送审挡回）`))
        continue
      }
      const missing: string[] = []
      if (!textOf(row['偏差类型']) || !isKnownDeviationType(textOf(row['偏差类型']))) {
        missing.push('偏差类型')
      }
      if (!textOf(row['根本原因'])) {
        missing.push('根本原因')
      }
      if (missing.length) {
        outcome.held.push(makeReceipt(row, 'held', `缺${missing.join('、')}，先放一边补齐后再送调查`))
        continue
      }
      if (!isAllowedAction(textOf(row['纠正措施']))) {
        outcome.rejected.push(makeReceipt(row, 'rejected', '纠正措施不在手册允许范围内，打回重填后再送'))
        continue
      }
      seenCodes.add(code)
      updated = {
        ...row,
        status: '调查中',
        pending: true,
        责任车间: assignWorkshop(textOf(row['发生工序'])),
      }
      outcome.accepted.push(
        makeReceipt(updated, 'accepted', `已受理送调查，按发生工序分派「${updated.责任车间}」，状态推进为调查中`),
      )
    } else if (action === '提交复核') {
      if (status !== '调查中') {
        outcome.rejected.push(makeReceipt(row, 'rejected', `当前「${status}」，只有调查中的偏差可送质量部复核，越级挡回`))
        continue
      }
      if (!textOf(row['调查结论'])) {
        outcome.rejected.push(makeReceipt(row, 'rejected', '调查结论为空，打回重填后再送质量部复核'))
        continue
      }
      seenCodes.add(code)
      updated = { ...row, status: '待质量复核', pending: true }
      outcome.accepted.push(makeReceipt(updated, 'accepted', '调查结论已送质量部复核，状态推进为待质量复核'))
    } else if (action === '质量复核通过') {
      if (status !== '待质量复核') {
        outcome.rejected.push(makeReceipt(row, 'rejected', `当前「${status}」，未经调查与复核流程不得关闭，越级挡回`))
        continue
      }
      if (!textOf(row['调查结论'])) {
        outcome.rejected.push(makeReceipt(row, 'rejected', '调查结论为空，质量部不予复核通过'))
        continue
      }
      seenCodes.add(code)
      updated = { ...row, status: '已关闭', pending: false }
      outcome.accepted.push(makeReceipt(updated, 'accepted', '质量部复核通过，偏差关闭'))
      syncCleaningTodo(updated)
    } else if (action === '升级偏差') {
      if (isTerminalStatus(status)) {
        outcome.rejected.push(makeReceipt(row, 'rejected', `当前「${status}」为终态，不能再升级`))
        continue
      }
      if (!textOf(row['偏差类型']) || !isKnownDeviationType(textOf(row['偏差类型']))) {
        outcome.held.push(makeReceipt(row, 'held', '偏差类型缺失或不在手册口径内，先补类型再判定能否升级'))
        continue
      }
      if (textOf(row['偏差类型']) !== '重大偏差') {
        outcome.rejected.push(makeReceipt(row, 'rejected', `偏差类型为「${textOf(row['偏差类型'])}」，仅重大偏差可升级，挡回`))
        continue
      }
      seenCodes.add(code)
      updated = { ...row, status: '已升级', pending: false }
      outcome.accepted.push(makeReceipt(updated, 'accepted', '重大偏差已整组升级，状态置为已升级'))
    } else {
      outcome.rejected.push(makeReceipt(row, 'rejected', `${deviationMeta.entity}没有登记「${action}」这个动作`))
      continue
    }

    if (updated) {
      touched.set(Number(row.id), updated)
    }
  }

  if (touched.size) {
    const next = rows.map((row) => touched.get(Number(row.id)) ?? row)
    saveRows(DEVIATION_KEY, next)
  }

  return {
    ok: outcome.accepted.length > 0,
    message: summarizeBatch(action, outcome.accepted, outcome.held, outcome.rejected),
    ...outcome,
  }
}

// 保存处理草稿（根本原因 / 纠正措施 / 调查结论等）：纠正措施越界、偏差类型不在口径内一律打回重填，不动状态。
export function saveDeviationDraft(
  id: number,
  patch: { 偏差类型?: string; 根本原因?: string; 纠正措施?: string; 调查结论?: string; 责任人?: string },
): ActionResult {
  const rows = deviationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  const current = rows[index]
  if (isTerminalStatus(String(current.status))) {
    return { ok: false, message: `偏差已「${current.status}」，处理内容不再允许修改` }
  }
  if (patch.偏差类型 !== undefined && patch.偏差类型.trim() !== '' && !isKnownDeviationType(patch.偏差类型)) {
    return { ok: false, message: '偏差类型不在手册口径（重大偏差/主要偏差/次要偏差）内，打回重填' }
  }
  if (patch.纠正措施 !== undefined && !isAllowedAction(patch.纠正措施)) {
    return { ok: false, message: '纠正措施不在手册允许的措施清单内，打回重填' }
  }
  const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
  saveRows(DEVIATION_KEY, next)
  return { ok: true, message: '处理内容已保存（状态不变）' }
}

export type DeviationCreateInput = {
  偏差编号: string
  偏差类型: string
  发生工序: string
  偏差描述: string
  根本原因?: string
  纠正措施: string
  责任人?: string
}

// 登记偏差：编号唯一、类型沿用手册口径、纠正措施必须落在措施清单内，否则挡回。
export function createDeviation(input: DeviationCreateInput): ActionResult {
  const code = textOf(input.偏差编号)
  if (!code) {
    return { ok: false, message: '偏差编号不能为空' }
  }
  const rows = deviationRows()
  if (rows.some((row) => textOf(row['偏差编号']) === code)) {
    return { ok: false, message: `偏差编号 ${code} 已存在，不能重复登记` }
  }
  if (!textOf(input.发生工序)) {
    return { ok: false, message: '发生工序不能为空' }
  }
  if (!isKnownDeviationType(textOf(input.偏差类型))) {
    return { ok: false, message: '偏差类型必须沿用手册口径：重大偏差 / 主要偏差 / 次要偏差' }
  }
  if (!isAllowedAction(textOf(input.纠正措施))) {
    return { ok: false, message: '纠正措施不在手册允许的措施清单内，打回重填' }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待处理',
    pending: true,
    abnormal: false,
    偏差编号: code,
    偏差类型: textOf(input.偏差类型),
    发生工序: textOf(input.发生工序),
    责任车间: '',
    偏差描述: textOf(input.偏差描述),
    根本原因: textOf(input.根本原因),
    纠正措施: textOf(input.纠正措施),
    调查结论: '',
    责任人: textOf(input.责任人) || '待指派',
    偏差状态: '待处理',
  }
  saveRows(DEVIATION_KEY, [...rows, row])
  return { ok: true, message: `偏差 ${code} 已登记，当前状态「待处理」` }
}

// ── 清洁验证页的偏差联动待办 ────────────────────────────────────────────────

// 待办展示字段实时取自偏差台账：纠正措施在偏差页怎么改，清洁验证页看到的就是什么。
export function listCleanDeviationTodos(): CleanTodoView[] {
  const deviationByCode = new Map(
    deviationRows().map((row) => [textOf(row['偏差编号']), row]),
  )
  return listCleanTodos()
    .filter((todo) => deviationByCode.has(todo.来源偏差编号))
    .map((todo) => {
      const row = deviationByCode.get(todo.来源偏差编号)!
      return {
        ...row,
        status: todo.待办状态,
        来源偏差编号: todo.来源偏差编号,
        设备名称: inferEquipment(textOf(row['发生工序'])),
        取样点: '待确认',
        关联工序: textOf(row['发生工序']),
        待办状态: todo.待办状态,
        创建日期: todo.创建日期,
        纠正措施: textOf(row['纠正措施']),
        偏差类型: textOf(row['偏差类型']),
        偏差状态: String(row.status),
      } satisfies CleanTodoView
    })
}

export function completeCleanDeviationTodo(code: string): ActionResult {
  const todos = listCleanTodos()
  const index = todos.findIndex((todo) => todo.来源偏差编号 === code)
  if (index < 0) {
    return { ok: false, message: `清洁验证待办里没有来源偏差 ${code} 的记录` }
  }
  if (todos[index].待办状态 === '已办结') {
    return { ok: false, message: `来源偏差 ${code} 的待办已办结，不用重复操作` }
  }
  const next = todos.map((todo, i) => (i === index ? { ...todo, 待办状态: '已办结' } : todo))
  saveCleanTodos(next)
  return { ok: true, message: `来源偏差 ${code} 的清洁验证待办已办结` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
