import { useAppStore } from '../store/useAppStore'
import type { DatabaseSnapshot } from './fileStorage'

/** عکس‌فوری کامل وضعیت فعلی اپ — هم فایل واقعی روی دیسک (FileDatabaseBar) و هم بک‌اند
 * PHP/MySQL خودمیزبان (MysqlSyncBar) از همین یک تابع برای ساختن محتوایی که ذخیره می‌کنند
 * استفاده می‌کنند، تا شکل داده در هر دو مسیر ذخیره‌سازی یکسان بماند. */
export function buildAppSnapshot(): DatabaseSnapshot {
  const s = useAppStore.getState()
  return {
    fileFormatVersion: 1,
    savedAt: new Date().toISOString(),
    dishes: s.dishes,
    plan: s.plan,
    settings: s.settings,
    ingredientPriceLog: s.ingredientPriceLog,
    customIngredients: s.customIngredients,
  }
}
