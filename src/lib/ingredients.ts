import { ingredientGroupOf } from '../data/ingredientGroups'
import type { Dish, Ingredient, IngredientPriceLogEntry } from '../types'

export type IngredientPriceLog = Record<string, IngredientPriceLogEntry[]>

/** قیمت واحد فعلیِ واقعی یک ماده اولیه — اگر تا حالا از صفحه «مواد اولیه» یا فرم ویرایش غذا
 * قیمتش تغییر کرده باشد (جدیدترین رکورد لاگ، اولین عضو آرایه چون همیشه به اول اضافه می‌شود)،
 * همان؛ وگرنه قیمت پایه‌ی استخراج‌شده از کارت رسپی. */
export function currentIngredientPrice(name: string, baselineUnitPrice: number | null | undefined, log: IngredientPriceLog): number | null {
  const entries = log[name]
  if (entries && entries.length > 0) return entries[0].price
  return baselineUnitPrice ?? null
}

/** آخرین زمان تغییر دستی قیمت یک ماده اولیه — null یعنی هنوز هیچ‌وقت دستی تغییر نکرده (قیمت
 * فعلی همان قیمت پایه‌ی کارت رسپی است). */
export function lastPriceChangeAt(name: string, log: IngredientPriceLog): string | null {
  const entries = log[name]
  return entries && entries.length > 0 ? entries[0].changedAt : null
}

/** فهرست مواد اولیه‌ی یک غذا با قیمت واقعیِ فعلی (نه لزوماً قیمت پایه‌ی رسپی) روی هرکدام —
 * برای نمایش در فرم ویرایش غذا، همیشه از این تابع استفاده شود نه مستقیماً dish.ingredients. */
export function effectiveIngredients(ingredients: Ingredient[] | null | undefined, log: IngredientPriceLog): Ingredient[] {
  if (!ingredients) return []
  return ingredients.map((ing) => {
    const price = currentIngredientPrice(ing.name, ing.unitPrice, log)
    return { ...ing, unitPrice: price, lineTotal: price != null ? price * ing.quantity : null }
  })
}

/** جمع بهای مواد اولیه‌ی یک غذا با قیمت واقعیِ فعلی — معادل computeIngredientsCostTotal روی
 * effectiveIngredients، برای جایی که فقط جمع لازم است نه فهرست کامل. */
export function effectiveIngredientsCostTotal(ingredients: Ingredient[] | null | undefined, log: IngredientPriceLog): number | null {
  if (!ingredients || ingredients.length === 0) return null
  const totals = ingredients
    .map((ing) => currentIngredientPrice(ing.name, ing.unitPrice, log))
    .filter((p): p is number => p != null)
  if (totals.length === 0) return null
  let sum = 0
  for (let i = 0; i < ingredients.length; i++) {
    const price = currentIngredientPrice(ingredients[i].name, ingredients[i].unitPrice, log)
    if (price != null) sum += price * ingredients[i].quantity
  }
  return sum
}

export interface IngredientRow {
  name: string
  group: string
  unit: string
  unitPrice: number | null
  dishCount: number
  lastChangedAt: string | null
}

/** تعریف یک ماده اولیه‌ی «دستی» که کاربر از صفحه‌ی «مواد اولیه» اضافه کرده — قبل از استفاده در
 * هیچ غذایی هم در فهرست ظاهر می‌شود (dishCount صفر) تا بشود بعداً در فرم ویرایش غذا انتخابش کرد. */
export interface CustomIngredientDef {
  unit: string
  group: string
}
export type CustomIngredients = Record<string, CustomIngredientDef>

/** فهرست یکتا و تجمیع‌شده‌ی همه‌ی مواد اولیه‌ی استفاده‌شده در کل دیتابیس غذا به‌علاوه‌ی مواد اولیه‌ی
 * دستی‌ای که هنوز در هیچ غذایی استفاده نشده‌اند — مبنای صفحه‌ی «مواد اولیه» و منوی «افزودن ماده
 * اولیه» در فرم ویرایش غذا. هر ماده فقط یک‌بار ظاهر می‌شود، با تعداد غذاهایی که از آن استفاده می‌کنند. */
export function buildIngredientRows(dishes: Dish[], log: IngredientPriceLog, customIngredients: CustomIngredients = {}): IngredientRow[] {
  const byName = new Map<string, { unit: string; baselineUnitPrice: number | null; dishIds: Set<string>; group?: string }>()
  for (const dish of dishes) {
    if (!dish.ingredients) continue
    for (const ing of dish.ingredients) {
      const existing = byName.get(ing.name)
      if (existing) {
        existing.dishIds.add(dish.id)
        if (existing.baselineUnitPrice == null && ing.unitPrice != null) existing.baselineUnitPrice = ing.unitPrice
      } else {
        byName.set(ing.name, { unit: ing.unit, baselineUnitPrice: ing.unitPrice ?? null, dishIds: new Set([dish.id]) })
      }
    }
  }

  for (const [name, def] of Object.entries(customIngredients)) {
    const existing = byName.get(name)
    if (existing) existing.group = def.group
    else byName.set(name, { unit: def.unit, baselineUnitPrice: null, dishIds: new Set(), group: def.group })
  }

  const rows: IngredientRow[] = []
  for (const [name, info] of byName) {
    rows.push({
      name,
      group: info.group ?? ingredientGroupOf(name),
      unit: info.unit,
      unitPrice: currentIngredientPrice(name, info.baselineUnitPrice, log),
      dishCount: info.dishIds.size,
      lastChangedAt: lastPriceChangeAt(name, log),
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'fa'))
}
