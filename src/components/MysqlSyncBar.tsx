import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatJalaliDateTime } from '../lib/format'
import { buildAppSnapshot } from '../lib/snapshot'
import { fetchSnapshotFromApi, isApiBackendAvailable, saveSnapshotToApi } from '../lib/apiStorage'

type SyncStatus = 'checking' | 'not-available' | 'connected' | 'error'

/** نوار وضعیت بک‌اند خودمیزبان PHP/MySQL — برخلاف FileDatabaseBar (که کاربر خودش با یک کلیک
 * فایل را انتخاب می‌کند)، این یکی کاملاً خودکار است: در لود اپ یک‌بار بررسی می‌کند که آیا
 * api/db.php کنار همین صفحه سرو می‌شود یا نه (یعنی اپ زیر Laragon/XAMPP با بک‌اند PHP نصب شده،
 * نه به‌عنوان آرتیفکت/فایل تکی آفلاین). اگر بود، وضعیت اولیه از همان‌جا خوانده و از آن پس هر
 * تغییری با یک تأخیر کوتاه خودکار به آن سرور نوشته می‌شود؛ اگر نبود، این کامپوننت چیزی نشان
 * نمی‌دهد و برنامه دقیقاً مثل قبل با localStorage/فایل واقعی کار می‌کند — نگاه کنید به
 * README.md برای راه‌اندازی روی XAMPP/Laragon. */
export function MysqlSyncBar() {
  const [status, setStatus] = useState<SyncStatus>('checking')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    let cancelled = false
    ;(async () => {
      const available = await isApiBackendAvailable()
      if (cancelled) return
      if (!available) {
        setStatus('not-available')
        return
      }
      try {
        const snapshot = await fetchSnapshotFromApi()
        if (cancelled) return
        useAppStore.getState().loadSnapshot(snapshot)
        setLastSavedAt(snapshot.savedAt ?? null)
        setStatus('connected')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (status !== 'connected') return
    let timer: number | undefined
    const unsubscribe = useAppStore.subscribe(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        saveSnapshotToApi(buildAppSnapshot())
          .then(() => setLastSavedAt(new Date().toISOString()))
          .catch(() => setErrorMsg('ذخیره‌ی آخرین تغییر در MySQL ناموفق بود.'))
      }, 800)
    })
    return () => {
      unsubscribe()
      if (timer) window.clearTimeout(timer)
    }
  }, [status])

  if (status === 'checking' || status === 'not-available') return null

  if (status === 'error') {
    return <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">اتصال به دیتابیس MySQL ناموفق بود</span>
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">✓ متصل به دیتابیس MySQL</span>
      {lastSavedAt && <span className="text-xs text-slate-500">آخرین ذخیره: {formatJalaliDateTime(lastSavedAt)}</span>}
      {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
    </div>
  )
}
