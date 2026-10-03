<template>
  <section class="page" data-module="deviation">
    <header class="page-head">
      <div>
        <h2>偏差处理管理</h2>
        <p class="page-desc">维护偏差记录，围绕偏差编号、偏差类型、发生工序、偏差描述做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记偏差记录</button>
        <button class="btn" type="button" @click="exportRows">导出偏差处理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="batch-bar">
      <span>已选 {{ selectedIds.length }} 条</span>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="batchSubmit">
        批量送调查
      </button>
      <button class="btn" type="button" :disabled="!selectedIds.length" @click="batchEscalate">
        整组升级（仅严重偏差）
      </button>
      <button class="btn ghost" type="button" :disabled="!selectedIds.length" @click="clearSelection">
        清空选择
      </button>
    </div>

    <div v-if="receipt" class="receipt-panel">
      <header class="receipt-head">
        <strong>{{ receipt.action }}回执</strong>
        <button class="link" type="button" @click="receipt = null">收起</button>
      </header>
      <div v-for="group in receiptGroups" :key="group.kind" class="receipt-group">
        <p class="receipt-title" :data-kind="group.kind">{{ group.title }}（{{ group.items.length }} 条）</p>
        <ul v-if="group.items.length">
          <li v-for="item in group.items" :key="item.id">
            <span class="receipt-code">{{ item.code }}</span>
            <span>{{ item.message }}</span>
            <button v-if="item.kind === 'held'" class="link" type="button" @click="openEdit(item.id)">
              去补录
            </button>
          </li>
        </ul>
        <p v-else class="receipt-empty">无</p>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              :checked="allSelected"
              :disabled="!selectableIds.length"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <input
              type="checkbox"
              :checked="selectedIds.includes(Number(row.id))"
              :disabled="!isSelectable(row)"
              @change="toggleOne(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button v-if="isSelectable(row)" class="link" type="button" @click="openEdit(Number(row.id))">
              补录/修改
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无偏差处理数据，可先登记偏差记录</td>
        </tr>
      </tbody>
    </table>

    <div v-if="editingId !== null" class="edit-panel">
      <header class="receipt-head">
        <strong>补录/修改偏差 {{ editingCode }}</strong>
        <button class="link" type="button" @click="closeEdit">取消</button>
      </header>
      <div class="edit-grid">
        <label class="filter-item">
          <span>偏差类型（手册口径）</span>
          <select v-model="draft.偏差类型">
            <option value="">— 请选择 —</option>
            <option v-for="item in deviationTypes" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>严重程度</span>
          <select v-model="draft.严重程度">
            <option v-for="item in severityLevels" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="filter-item edit-wide">
          <span>根本原因</span>
          <input v-model="draft.根本原因" placeholder="调查后确认的根本原因" />
        </label>
        <label class="filter-item edit-wide">
          <span>纠正措施（{{ capaLength }}/{{ capaMin }}–{{ capaMax }} 字）</span>
          <textarea v-model="draft.纠正措施" rows="3" placeholder="纠正措施越界会被打回重填"></textarea>
        </label>
      </div>
      <div class="edit-actions">
        <button class="btn primary" type="button" @click="saveDraft">保存</button>
        <span v-if="editError" class="error-text">{{ editError }}</span>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条偏差处理记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  CAPA_MAX,
  CAPA_MIN,
  DEVIATION_TYPES,
  SEVERITY_LEVELS,
  advanceDeviation,
  ensureDeviationRows,
  escalateBatch,
  nextActionsFor,
  saveDeviationDraft,
  submitForInvestigation,
} from '@/api/deviation-service'
import type { BatchReceipt, ReceiptKind } from '@/api/deviation-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('deviation')
const columns = ["偏差编号", "偏差类型", "严重程度", "发生工序", "责任车间", "偏差描述", "根本原因", "纠正措施", "责任人", "偏差状态"]
const statuses = ["待处理", "调查中", "待复核", "已关闭", "已升级"]
const terminalStatuses = ["已关闭", "已升级"]

const deviationTypes = DEVIATION_TYPES
const severityLevels = SEVERITY_LEVELS
const capaMin = CAPA_MIN
const capaMax = CAPA_MAX

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<number[]>([])
const receipt = ref<BatchReceipt | null>(null)
const editingId = ref<number | null>(null)
const editError = ref('')
const draft = ref({ 偏差类型: '', 严重程度: '一般', 根本原因: '', 纠正措施: '' })

const stats = computed(() => [
  { label: '待处理偏差', value: countStatus('待处理') },
  { label: '调查中偏差', value: countStatus('调查中') },
  { label: '待质量复核', value: countStatus('待复核') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countStatus(status),
  })),
)

const selectableIds = computed(() =>
  rows.value.filter((row) => isSelectable(row)).map((row) => Number(row.id)),
)

const allSelected = computed(
  () => selectableIds.value.length > 0 && selectableIds.value.every((id) => selectedIds.value.includes(id)),
)

const receiptGroups = computed(() => {
  const groups: { kind: ReceiptKind; title: string; items: BatchReceipt['items'] }[] = [
    { kind: 'advanced', title: '已推进', items: [] },
    { kind: 'held', title: '待补全（先放一边）', items: [] },
    { kind: 'duplicate', title: '重复提交（只算一次）', items: [] },
    { kind: 'rejected', title: '未受理', items: [] },
  ]
  for (const item of receipt.value?.items ?? []) {
    groups.find((group) => group.kind === item.kind)?.items.push(item)
  }
  return groups
})

const editingCode = computed(() => {
  const row = rows.value.find((item) => Number(item.id) === editingId.value)
  return row ? String(row['偏差编号'] ?? '') : ''
})

const capaLength = computed(() => draft.value.纠正措施.trim().length)

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function isSelectable(row: EntryRow): boolean {
  return !terminalStatuses.includes(String(row.status))
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === null || String(value).trim() === '') {
    return '—'
  }
  return String(value)
}

function rowActions(row: EntryRow): string[] {
  return nextActionsFor(String(row.status))
}

function toggleOne(id: number) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : [...selectableIds.value]
}

function clearSelection() {
  selectedIds.value = []
}

function showReceipt(next: BatchReceipt) {
  receipt.value = next
  selectedIds.value = []
  reload()
}

function batchSubmit() {
  errorMessage.value = ''
  showReceipt(submitForInvestigation([...selectedIds.value]))
}

function batchEscalate() {
  errorMessage.value = ''
  showReceipt(escalateBatch([...selectedIds.value]))
}

function openEdit(id: number) {
  const row = rows.value.find((item) => Number(item.id) === id)
  if (!row) {
    return
  }
  editingId.value = id
  editError.value = ''
  draft.value = {
    偏差类型: String(row['偏差类型'] ?? ''),
    严重程度: String(row['严重程度'] ?? '一般'),
    根本原因: String(row['根本原因'] ?? ''),
    纠正措施: String(row['纠正措施'] ?? ''),
  }
}

function closeEdit() {
  editingId.value = null
  editError.value = ''
}

function saveDraft() {
  if (editingId.value === null) {
    return
  }
  const result = saveDeviationDraft(editingId.value, { ...draft.value })
  if (!result.ok) {
    editError.value = result.message
    return
  }
  closeEdit()
  noticeMessage.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '偏差记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceDeviation(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    ensureDeviationRows()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    selectedIds.value = selectedIds.value.filter((id) =>
      payload.items.some((row) => Number(row.id) === id && isSelectable(row)),
    )
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '偏差处理列表读取失败'
  }
}

onMounted(reload)
</script>
