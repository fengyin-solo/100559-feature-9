<template>
  <section class="page" data-module="deviation">
    <header class="page-head">
      <div>
        <h2>偏差处理管理</h2>
        <p class="page-desc">
          偏差类型沿用手册口径（重大/主要/次要），按发生工序分派责任车间；勾选多条可批量送调查并逐条回执，
          状态单向推进（待处理 → 调查中 → 待质量复核 → 已关闭），重大偏差可整组升级。
        </p>
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

    <div class="bulk-bar">
      <label class="select-all">
        <input type="checkbox" :checked="allChecked" :indeterminate.prop="someChecked" @change="toggleAll" />
        全选本页
      </label>
      <span class="bulk-count">已勾 {{ selectedIds.length }} 条</span>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="runBatch('提交调查')">
        批量送调查
      </button>
      <button class="btn danger" type="button" :disabled="!selectedIds.length" @click="runBatch('升级偏差')">
        整组升级（重大偏差）
      </button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">勾选</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': isSelected(row.id) }">
          <td class="col-check">
            <input type="checkbox" :checked="isSelected(row.id)" @change="toggleOne(row.id)" />
          </td>
          <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
          <td>
            <span :class="['status-pill', `st-${String(row.status)}`]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="!isTerminal(String(row.status))">
              <button class="link" type="button" @click="openProcess(row)">处理</button>
              <button v-if="String(row.status) === '待处理'" class="link" type="button" @click="runSingle('提交调查', row)">
                送调查
              </button>
              <button v-else-if="String(row.status) === '调查中'" class="link" type="button" @click="runSingle('提交复核', row)">
                送质量部复核
              </button>
              <button
                v-else-if="String(row.status) === '待质量复核'"
                class="link link-pass"
                type="button"
                @click="runSingle('质量复核通过', row)"
              >
                质量复核通过
              </button>
            </template>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无偏差处理数据，可先登记偏差记录</td>
        </tr>
      </tbody>
    </table>

    <div v-if="lastBatch" class="receipt-panel">
      <header class="receipt-head">
        <strong>批量回执</strong>
        <span :class="lastBatch.ok ? 'receipt-summary ok' : 'receipt-summary warn'">{{ lastBatch.message }}</span>
        <button class="link" type="button" @click="lastBatch = null">收起</button>
      </header>
      <div v-if="lastBatch.accepted.length" class="receipt-group accepted">
        <h4>已受理（{{ lastBatch.accepted.length }}）</h4>
        <p v-for="item in lastBatch.accepted" :key="`a-${item.id}`">
          <b>{{ item.code }}</b>：{{ item.message }}
        </p>
      </div>
      <div v-if="lastBatch.held.length" class="receipt-group held">
        <h4>暂缓受理 · 先放一边（{{ lastBatch.held.length }}）</h4>
        <p v-for="item in lastBatch.held" :key="`h-${item.id}`">
          <b>{{ item.code }}</b>：{{ item.message }}
        </p>
      </div>
      <div v-if="lastBatch.rejected.length" class="receipt-group rejected">
        <h4>挡回（{{ lastBatch.rejected.length }}）</h4>
        <p v-for="item in lastBatch.rejected" :key="`r-${item.id}`">
          <b>{{ item.code }}</b>：{{ item.message }}
        </p>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条偏差处理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 处理弹窗：补根本原因 / 调查结论，选纠正措施；越界保存会被打回。 -->
    <div v-if="processTarget" class="modal-mask" @click.self="closeProcess">
      <form class="modal" @submit.prevent="submitProcess">
        <h3>处理偏差 {{ textVal(processTarget['偏差编号']) }}</h3>
        <p class="modal-hint">当前状态「{{ processTarget.status }}」；保存只更新处理内容，不改变状态。</p>
        <label class="form-item">
          <span>偏差类型（手册口径）</span>
          <select v-model="processForm.偏差类型">
            <option value="" disabled>请选择偏差类型</option>
            <option v-for="item in deviationTypes" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>根本原因</span>
          <textarea v-model="processForm.根本原因" rows="2" placeholder="送调查前必填"></textarea>
        </label>
        <label class="form-item">
          <span>纠正措施（手册措施清单）</span>
          <select v-model="processForm.纠正措施">
            <option value="" disabled>请选择纠正措施</option>
            <option v-for="item in actionCatalog" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>调查结论（送质量部复核前必填）</span>
          <textarea v-model="processForm.调查结论" rows="3" placeholder="车间调查结论，需经质量部复核"></textarea>
        </label>
        <label class="form-item">
          <span>责任人</span>
          <input v-model="processForm.责任人" />
        </label>
        <p v-if="processError" class="error-text">{{ processError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeProcess">取消</button>
          <button class="btn primary" type="submit">保存处理内容</button>
        </div>
      </form>
    </div>

    <!-- 登记弹窗 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记偏差记录</h3>
        <label class="form-item">
          <span>偏差编号</span>
          <input v-model="createForm.偏差编号" placeholder="如 DEVI-2026-0008" />
        </label>
        <label class="form-item">
          <span>偏差类型（手册口径）</span>
          <select v-model="createForm.偏差类型">
            <option value="" disabled>请选择偏差类型</option>
            <option v-for="item in deviationTypes" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>发生工序（决定责任车间分派）</span>
          <input v-model="createForm.发生工序" placeholder="如 灌装线清洁 / 配液 / 压片" />
        </label>
        <label class="form-item">
          <span>偏差描述</span>
          <textarea v-model="createForm.偏差描述" rows="2"></textarea>
        </label>
        <label class="form-item">
          <span>根本原因（暂未查明可留空，送调查前补齐）</span>
          <textarea v-model="createForm.根本原因" rows="2"></textarea>
        </label>
        <label class="form-item">
          <span>纠正措施（手册措施清单）</span>
          <select v-model="createForm.纠正措施">
            <option value="" disabled>请选择纠正措施</option>
            <option v-for="item in actionCatalog" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">登记</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  batchDeviationAction,
  createDeviation,
  downloadEntries,
  listEntries,
  moduleMeta,
  saveDeviationDraft,
} from '@/api/local-service'
import { CORRECTIVE_ACTION_CATALOG, DEVIATION_STATUSES, DEVIATION_TERMINAL_STATUSES, DEVIATION_TYPES } from '@/data/deviation-policy'
import type { BatchActionResult, EntryRow } from '@/data/types'

const meta = moduleMeta('deviation')
const columns = ["偏差编号", "偏差类型", "发生工序", "责任车间", "根本原因", "纠正措施", "调查结论", "责任人"]
const deviationTypes = [...DEVIATION_TYPES]
const actionCatalog = [...CORRECTIVE_ACTION_CATALOG]
const terminalStatuses = new Set<string>(DEVIATION_TERMINAL_STATUSES)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["偏差编号", "偏差类型", "发生工序"]
const selected = ref<Set<number>>(new Set())
const lastBatch = ref<BatchActionResult | null>(null)

const createOpen = ref(false)
const createError = ref('')
const emptyCreateForm = () => ({
  偏差编号: '',
  偏差类型: '',
  发生工序: '',
  偏差描述: '',
  根本原因: '',
  纠正措施: '',
})
const createForm = ref(emptyCreateForm())

const processTarget = ref<EntryRow | null>(null)
const processForm = ref({ 偏差类型: '', 根本原因: '', 纠正措施: '', 调查结论: '', 责任人: '' })
const processError = ref('')

const stats = computed(() => [
  { label: '待处理偏差', value: countByStatus(['待处理']) },
  { label: '调查中偏差', value: countByStatus(['调查中', '待质量复核']) },
  { label: '已升级偏差', value: countByStatus(['已升级']) },
  { label: '累计关闭数', value: countByStatus(['已关闭']) },
])

const statusSummary = computed(() =>
  [...DEVIATION_STATUSES].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const allChecked = computed(() => rows.value.length > 0 && rows.value.every((row) => selected.value.has(Number(row.id))))
const someChecked = computed(() => rows.value.some((row) => selected.value.has(Number(row.id))) && !allChecked.value)
const selectedIds = computed(() => rows.value.filter((row) => selected.value.has(Number(row.id))).map((row) => Number(row.id)))

function countByStatus(statuses: string[]): number {
  return rows.value.filter((row) => statuses.includes(String(row.status))).length
}

function isTerminal(status: string): boolean {
  return terminalStatuses.has(status)
}

function textVal(value: unknown): string {
  const text = String(value ?? '').trim()
  return text || '—'
}

function display(row: EntryRow, column: string): string {
  if (column === '责任车间' && !String(row[column] ?? '').trim()) {
    return '送调查后按工序分派'
  }
  return textVal(row[column])
}

function isSelected(id: number): boolean {
  return selected.value.has(id)
}

function toggleOne(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selected.value = next
}

function toggleAll() {
  if (allChecked.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set(rows.value.map((row) => Number(row.id)))
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createForm.value = emptyCreateForm()
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function submitCreate() {
  const result = createDeviation({ ...createForm.value })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  errorMessage.value = result.message
  reload()
}

function openProcess(row: EntryRow) {
  processTarget.value = row
  processForm.value = {
    偏差类型: String(row['偏差类型'] ?? ''),
    根本原因: String(row['根本原因'] ?? ''),
    纠正措施: String(row['纠正措施'] ?? ''),
    调查结论: String(row['调查结论'] ?? ''),
    责任人: String(row['责任人'] ?? ''),
  }
  processError.value = ''
}

function closeProcess() {
  processTarget.value = null
}

function submitProcess() {
  if (!processTarget.value) {
    return
  }
  const result = saveDeviationDraft(Number(processTarget.value.id), { ...processForm.value })
  if (!result.ok) {
    processError.value = result.message
    return
  }
  processTarget.value = null
  errorMessage.value = result.message
  reload()
}

function runBatch(action: string) {
  const ids = selectedIds.value
  if (!ids.length) {
    return
  }
  const result = batchDeviationAction(ids, action)
  lastBatch.value = result
  errorMessage.value = result.held.length || result.rejected.length ? result.message : ''
  selected.value = new Set()
  reload()
}

function runSingle(action: string, row: EntryRow) {
  const result = batchDeviationAction([Number(row.id)], action)
  lastBatch.value = result
  errorMessage.value = result.rejected.length ? result.rejected[0].message : ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    // 勾选项只保留当前筛选结果里还存在的，避免翻条件后误操作到看不见的记录。
    const visible = new Set(payload.items.map((row) => Number(row.id)))
    selected.value = new Set([...selected.value].filter((id) => visible.has(id)))
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '偏差处理列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.col-check {
  width: 42px;
  text-align: center;
}
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bulk-count {
  color: var(--muted);
}
.btn.danger {
  border-color: #d92d20;
  color: #b42318;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.row-selected {
  background: #f0f6ff;
}
.status-pill {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.st-待处理 { background: #e2e8f0; color: #334155; }
.st-调查中 { background: #fef3c7; color: #92400e; }
.st-待质量复核 { background: #dbeafe; color: #1e40af; }
.st-已关闭 { background: #dcfce7; color: #166534; }
.st-已升级 { background: #fee2e2; color: #991b1b; }
.muted-text { color: var(--muted); }
.link-pass { color: #166534; font-weight: 600; }
.receipt-panel {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 10px 14px;
}
.receipt-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.receipt-summary { font-size: 13px; }
.receipt-summary.ok { color: #166534; }
.receipt-summary.warn { color: #b42318; }
.receipt-group { margin: 6px 0; font-size: 13px; }
.receipt-group h4 { margin: 6px 0 2px; font-size: 13px; }
.receipt-group p { margin: 2px 0; padding-left: 8px; }
.receipt-group.accepted h4 { color: #166534; }
.receipt-group.held h4 { color: #b45309; }
.receipt-group.rejected h4 { color: #b42318; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 560px;
  max-height: 86vh;
  overflow-y: auto;
}
.modal h3 { margin: 0 0 4px; }
.modal-hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.form-item { display: block; margin-bottom: 10px; font-size: 13px; }
.form-item span { display: block; color: var(--muted); margin-bottom: 4px; }
.form-item input,
.form-item select,
.form-item textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
