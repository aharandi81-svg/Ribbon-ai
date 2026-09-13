import type { DatabaseSnapshot } from './fileStorage'

// آدرس API نسبت به مسیر خودِ صفحه است (نه یک هاست ثابت) چون این حالت فقط وقتی معنا دارد که
// فرانت بیلدشده (dist/) و پوشه‌ی api/ کنار هم زیر همان Apache (XAMPP/Laragon) سرو شوند — نگاه
// کنید به db/schema.sql و راهنمای استقرار در README.md.
const API_URL = 'api/db.php'
const PROBE_TIMEOUT_MS = 1500

/** آیا بک‌اند PHP/MySQL خودمیزبان در همین آدرس در دسترس است؟ — یک GET با timeout کوتاه؛ در
 * محیط‌هایی که این پوشه‌ی api/ اصلاً سرو نمی‌شود (مثلاً آرتیفکت claude.ai یا فایل تکیِ آفلاین)
 * این fetch شکست می‌خورد و برنامه بی‌صدا به همان localStorage قبلی برمی‌گردد. */
export async function isApiBackendAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(API_URL, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export async function fetchSnapshotFromApi(): Promise<DatabaseSnapshot> {
  const res = await fetch(API_URL, { method: 'GET' })
  if (!res.ok) throw new Error('دریافت اطلاعات از سرور ناموفق بود.')
  return (await res.json()) as DatabaseSnapshot
}

export async function saveSnapshotToApi(snapshot: DatabaseSnapshot): Promise<void> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) throw new Error('ذخیره در سرور ناموفق بود.')
}
