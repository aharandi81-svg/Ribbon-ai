import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatJalaliDateTime } from '../lib/format'
import { buildAppSnapshot } from '../lib/snapshot'
import {
  clearSavedHandle,
  createNewDatabaseFile,
  isFileSystemAccessSupported,
  loadSavedHandle,
  pickExistingDatabaseFile,
  saveHandleForNextTime,
  verifyPermission,
  writeDatabaseFile,
} from '../lib/fileStorage'

type ConnectionStatus = 'checking' | 'disconnected' | 'needs-permission' | 'connected' | 'saving' | 'error'

/** نوار وضعیت «فایل دیتابیس واقعی» در هدر — به کاربر اجازه می‌دهد کل وضعیت برنامه (دیتابیس غذا،
 * سناریو، تنظیمات، لاگ قیمت مواد اولیه) را به یک فایل JSON واقعی روی کامپیوتر خودش وصل کند؛ از آن
 * پس هر تغییری در برنامه با یک تأخیر کوتاه خودکار در همان فایل ذخیره می‌شود. کاملاً آفلاین کار
 * می‌کند و به هیچ سروری متکی نیست — فقط File System Access API مرورگر (Chrome/Edge). در
 * مرورگرهایی که این API را ندارند (فایرفاکس/سافاری)، برنامه بدون تغییر همان localStorage قبلی را
 * استفاده می‌کند. */
export function FileDatabaseBar() {
  const supported = isFileSystemAccessSupported()
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [fileName, setFileName] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const handleRef = useRef<FileSystemFileHandle | null>(null)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    ;(async () => {
      setStatus('checking')
      try {
        const saved = await loadSavedHandle()
        if (!saved || cancelled) {
          if (!cancelled) setStatus('disconnected')
          return
        }
        const granted = (await saved.queryPermission({ mode: 'readwrite' })) === 'granted'
        if (cancelled) return
        handleRef.current = saved
        setFileName(saved.name)
        setStatus(granted ? 'connected' : 'needs-permission')
      } catch {
        if (!cancelled) setStatus('disconnected')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supported])

  useEffect(() => {
    if (status !== 'connected' || !handleRef.current) return
    let timer: number | undefined
    const unsubscribe = useAppStore.subscribe(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const handle = handleRef.current
        if (!handle) return
        writeDatabaseFile(handle, buildAppSnapshot())
          .then(() => setLastSavedAt(new Date().toISOString()))
          .catch(() => setStatus('error'))
      }, 800)
    })
    return () => {
      unsubscribe()
      if (timer) window.clearTimeout(timer)
    }
  }, [status])

  const handleOpen = async () => {
    setErrorMsg(null)
    try {
      const result = await pickExistingDatabaseFile()
      if (!result) return
      useAppStore.getState().loadSnapshot(result.snapshot)
      await saveHandleForNextTime(result.handle)
      handleRef.current = result.handle
      setFileName(result.handle.name)
      setLastSavedAt(result.snapshot.savedAt ?? null)
      setStatus('connected')
    } catch {
      setStatus('error')
      setErrorMsg('باز کردن فایل ناموفق بود — مطمئن شوید فایل معتبری از همین برنامه است.')
    }
  }

  const handleCreate = async () => {
    setErrorMsg(null)
    try {
      const handle = await createNewDatabaseFile(buildAppSnapshot())
      if (!handle) return
      await saveHandleForNextTime(handle)
      handleRef.current = handle
      setFileName(handle.name)
      setLastSavedAt(new Date().toISOString())
      setStatus('connected')
    } catch {
      setStatus('error')
      setErrorMsg('ایجاد فایل ناموفق بود.')
    }
  }

  const handleReconnect = async () => {
    setErrorMsg(null)
    const handle = handleRef.current
    if (!handle) return
    const granted = await verifyPermission(handle, 'readwrite')
    setStatus(granted ? 'connected' : 'needs-permission')
    if (!granted) setErrorMsg('دسترسی داده نشد.')
  }

  const handleDisconnect = async () => {
    await clearSavedHandle()
    handleRef.current = null
    setFileName(null)
    setLastSavedAt(null)
    setStatus('disconnected')
    setErrorMsg(null)
  }

  if (!supported) {
    return (
      <span className="text-xs text-slate-500" title="این مرورگر از ذخیره‌ی مستقیم روی فایل پشتیبانی نمی‌کند — از Chrome یا Edge استفاده کنید. داده در حافظه‌ی داخلی مرورگر (localStorage) ذخیره می‌شود.">
        دیتابیس: فقط حافظه‌ی مرورگر
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status === 'connected' && fileName && (
          <>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
              ✓ ذخیره خودکار در «{fileName}»
            </span>
            {lastSavedAt && <span className="text-xs text-slate-500">آخرین ذخیره: {formatJalaliDateTime(lastSavedAt)}</span>}
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              قطع اتصال
            </button>
          </>
        )}

        {status === 'needs-permission' && fileName && (
          <>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">«{fileName}» نیاز به تأیید دسترسی دارد</span>
            <button
              type="button"
              onClick={() => void handleReconnect()}
              className="rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-300"
            >
              اتصال مجدد
            </button>
          </>
        )}

        {(status === 'disconnected' || status === 'error') && (
          <>
            <button
              type="button"
              onClick={() => void handleOpen()}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              باز کردن فایل دیتابیس…
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-300"
            >
              + ایجاد فایل دیتابیس جدید
            </button>
          </>
        )}

        {status === 'checking' && <span className="text-xs text-slate-500">در حال بررسی اتصال قبلی…</span>}
      </div>
      {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
    </div>
  )
}
