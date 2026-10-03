<template>
  <section class="page" data-module="cleanvalidate">
    <header class="page-head">
      <div>
        <h2>清洁验证管理</h2>
        <p class="page-desc">维护清洁验证记录，围绕验证编号、设备名称、清洁规程、取样点做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清洁验证记录</button>
        <button class="btn" type="button" @click="exportRows">导出清洁验证清单</button>
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无清洁验证数据，可先登记清洁验证记录</td>
        </tr>
      </tbody>
    </table>

    <section class="todo-section">
      <header class="todo-head">
        <div>
          <h3>偏差联动待办</h3>
          <p class="page-desc">
            影响清洁验证的偏差经质量部复核通过后自动挂到这里；纠正措施与偏差台账实时同源，两处看到的始终一致。
          </p>
        </div>
        <label class="todo-filter">
          <input v-model="hideDone" type="checkbox" />
          仅看待办
        </label>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in todoColumns" :key="column">{{ column }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in visibleTodos" :key="todo.来源偏差编号">
            <td v-for="column in todoColumns" :key="column">{{ todo[column] ?? '—' }}</td>
            <td class="row-actions">
              <button
                v-if="todo.待办状态 === '待办'"
                class="link link-pass"
                type="button"
                @click="finishTodo(todo.来源偏差编号)"
              >
                办结待办
              </button>
              <span v-else class="muted-text">已办结</span>
            </td>
          </tr>
          <tr v-if="!visibleTodos.length">
            <td :colspan="todoColumns.length + 1" class="empty-state">暂无偏差联动待办</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条清洁验证记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  completeCleanDeviationTodo,
  downloadEntries,
  listCleanDeviationTodos,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { CleanTodoView, EntryRow } from '@/data/types'

const meta = moduleMeta('cleanvalidate')
const columns = ["验证编号", "设备名称", "清洁规程", "取样点", "残留限度", "检测结果", "验证人", "验证状态"]
const actions = ["提交验证", "确认验证", "判定失败"]
const statuses = ["待验证", "验证中", "已验证", "验证失败"]
const stats = [{"label": "待验证设备", "value": 0}, {"label": "验证中设备", "value": 0}, {"label": "已验证设备", "value": 0}]

// 联动待办展示列：纠正措施取自偏差台账（同源），这里没有单独的编辑入口。
const todoColumns = ["来源偏差编号", "设备名称", "关联工序", "取样点", "纠正措施", "偏差类型", "偏差状态", "待办状态", "创建日期"]

const rows = ref<EntryRow[]>([])
const todos = ref<CleanTodoView[]>([])
const hideDone = ref(true)
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const visibleTodos = computed(() =>
  hideDone.value ? todos.value.filter((todo) => todo.待办状态 === '待办') : todos.value,
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '清洁验证记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function finishTodo(code: string) {
  const result = completeCleanDeviationTodo(code)
  errorMessage.value = result.ok ? '' : result.message
  reloadTodos()
}

function reloadTodos() {
  todos.value = listCleanDeviationTodos()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清洁验证列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.todo-section {
  margin-top: 18px;
}
.todo-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
.todo-head h3 {
  margin: 0;
  font-size: 15px;
}
.todo-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.muted-text { color: var(--muted); }
.link-pass { color: #166534; font-weight: 600; }
</style>
