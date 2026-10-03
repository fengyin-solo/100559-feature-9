import { SEED_CLEAN_TODOS, SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 清洁验证页的「偏差联动待办」：只存引用键（来源偏差编号）与办结信息，
// 纠正措施、设备等展示字段都从偏差台账实时取，保证两处看到的对得上。
const CLEAN_TODO_KEY = 'pharma-cleanroom:clean-deviation-todos'

export type CleanTodoRecord = {
  来源偏差编号: string
  待办状态: string
  创建日期: string
}

function readCleanTodos(): CleanTodoRecord[] {
  const fallback = clone(SEED_CLEAN_TODOS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(CLEAN_TODO_KEY)
  if (!raw) {
    window.localStorage.setItem(CLEAN_TODO_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as CleanTodoRecord[]
  } catch {
    window.localStorage.setItem(CLEAN_TODO_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let todoCache: CleanTodoRecord[] | null = null

export function listCleanTodos(): CleanTodoRecord[] {
  if (todoCache === null) {
    todoCache = readCleanTodos()
  }
  return todoCache
}

export function saveCleanTodos(todos: CleanTodoRecord[]): void {
  todoCache = todos
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CLEAN_TODO_KEY, JSON.stringify(todos))
  }
}

export function resetCleanTodos(): CleanTodoRecord[] {
  const seeded = clone(SEED_CLEAN_TODOS)
  saveCleanTodos(seeded)
  return seeded
}

export function storageKey(): string {
  return STORAGE_KEY
}
