import type { Dish } from '../types'
// دیتابیس واقعی غذاها، تولیدشده توسط scripts/extract_dishes.py از فایل اکسل سوابق رویدادها.
import raw from '../../data/dishes.json'

// dishes.json از اسکریپت استخراج اکسل می‌آید و فیلد dataReviewed را ندارد — پیش‌فرض false
// (بازبینی‌نشده) تا کاربر بتواند دیتاهای اشتباه احتمالی را پیدا و تیک بزند (نگاه کنید به
// DishDatabasePage و USER_EDITABLE_DISH_FIELDS در useAppStore.ts که این تیک را حفظ می‌کند).
export const dishes: Dish[] = (raw as Dish[]).map((d) => ({ ...d, dataReviewed: d.dataReviewed ?? false }))

export function buildDishesById(list: Dish[] = dishes): Map<string, Dish> {
  return new Map(list.map((d) => [d.id, d]))
}
