import type { AppSettings, Dish, EventPlan, IngredientPriceLogEntry } from '../types'
import type { CustomIngredients } from './ingredients'

/** عکس‌فوری کامل داده‌ی برنامه — همان چیزی که در فایل دیتابیس روی دیسک کاربر ذخیره می‌شود. برخلاف
 * خروجی اکسل (که فقط دیتابیس غذاست)، این عکس‌فوری شامل تنظیمات رویداد، سناریوی انتخاب غذا، و لاگ
 * قیمت مواد اولیه هم می‌شود — یعنی کل وضعیت برنامه. */
export interface DatabaseSnapshot {
  fileFormatVersion: 1
  savedAt: string
  dishes: Dish[]
  plan: EventPlan
  settings: AppSettings
  ingredientPriceLog: Record<string, IngredientPriceLogEntry[]>
  customIngredients: CustomIngredients
}

/** فایل‌سیستم API فقط روی مرورگرهای Chromium (کروم/اج) در یک بستر امن (https یا localhost) در
 * دسترس است — نه فایرفاکس/سافاری، و نه لزوماً وقتی صفحه مستقیم با file:// باز شده باشد. */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** کاربر یک فایل JSON دیتابیس موجود را از روی کامپیوترش انتخاب می‌کند. null یعنی خودش انصراف داد. */
export async function pickExistingDatabaseFile(): Promise<{ handle: FileSystemFileHandle; snapshot: DatabaseSnapshot } | null> {
  try {
    const [handle] = await window.showOpenFilePicker({
      id: 'buffet-planner-db',
      types: [{ description: 'فایل دیتابیس برنامه‌ریز بوفه', accept: { 'application/json': ['.json'] } }],
    })
    const file = await handle.getFile()
    const text = await file.text()
    const snapshot = JSON.parse(text) as DatabaseSnapshot
    return { handle, snapshot }
  } catch (err) {
    if (isAbortError(err)) return null
    throw err
  }
}

/** ایجاد یک فایل JSON دیتابیس جدید روی کامپیوتر کاربر، با محتوای اولیه‌ی داده‌شده. null یعنی
 * خودش انصراف داد. */
export async function createNewDatabaseFile(initialSnapshot: DatabaseSnapshot): Promise<FileSystemFileHandle | null> {
  try {
    const handle = await window.showSaveFilePicker({
      id: 'buffet-planner-db',
      suggestedName: 'buffet-planner-db.json',
      types: [{ description: 'فایل دیتابیس برنامه‌ریز بوفه', accept: { 'application/json': ['.json'] } }],
    })
    await writeDatabaseFile(handle, initialSnapshot)
    return handle
  } catch (err) {
    if (isAbortError(err)) return null
    throw err
  }
}

export async function writeDatabaseFile(handle: FileSystemFileHandle, snapshot: DatabaseSnapshot): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(snapshot, null, 2))
  await writable.close()
}

/** بررسی/درخواست دسترسی خواندن-نوشتن روی یک FileSystemFileHandle قبلاً ذخیره‌شده — queryPermission
 * بدون نیاز به تعامل کاربر جواب می‌دهد؛ اگر رد شد، requestPermission (که باید از دل یک کلیک واقعی
 * کاربر صدا زده شود) امتحان می‌شود. */
export async function verifyPermission(handle: FileSystemFileHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const opts = { mode }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if ((await handle.requestPermission(opts)) === 'granted') return true
  return false
}

const IDB_NAME = 'buffet-planner-file-handles'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'database-file'

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** خودِ FileSystemFileHandle قابل structured-clone است، پس می‌شود در IndexedDB نگهش داشت تا کاربر
 * مجبور نباشد هر بار که صفحه را رفرش می‌کند دوباره فایل را انتخاب کند — نگاه کنید به loadSavedHandle. */
export async function saveHandleForNextTime(handle: FileSystemFileHandle): Promise<void> {
  const db = await openHandleDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadSavedHandle(): Promise<FileSystemFileHandle | null> {
  const db = await openHandleDB()
  const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY)
    req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return handle
}

export async function clearSavedHandle(): Promise<void> {
  const db = await openHandleDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
