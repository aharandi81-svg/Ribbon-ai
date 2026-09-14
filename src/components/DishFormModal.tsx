import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Button, Checkbox, Field, FormattedNumberInput, Modal, NumberInput, Select } from './ui'
import { buildIngredientRows, effectiveIngredients, effectiveIngredientsCostTotal } from '../lib/ingredients'
import { computeIngredientsCostTotal } from '../lib/calculations'
import { INGREDIENT_GROUP_ORDER } from '../data/ingredientGroups'
import { formatRial } from '../lib/format'
import {
  CATEGORIES,
  COOKING_METHODS,
  DIETARY_TAGS,
  PROTEIN_SOURCES,
  PROTEIN_SOURCE_LABELS,
  WASTE_RISK_LEVELS,
} from '../types'
import type { Category, CookingMethod, Dish, DietaryTag, Ingredient, MacroKey, NewDishInput, ProteinSourceType, WasteRisk } from '../types'

const macroKeys: MacroKey[] = ['carb', 'protein', 'veg', 'fat']
const macroLabels: Record<MacroKey, string> = { carb: 'کربوهیدرات', protein: 'پروتئین', veg: 'سبزیجات', fat: 'چربی' }
const NO_COOKING_METHOD = 'بدون پخت (نوشیدنی/آماده)' as const

function makeInitialForm(category: Category): NewDishInput {
  return {
    name: '',
    category,
    macro: { carb: 25, protein: 25, veg: 25, fat: 25 },
    costPerServing: null,
    referencePortionGrams: 250,
    dietaryTags: [],
    isBreakfastItem: false,
    wasteRisk: 'فسادپذیر',
    proteinSource: 'plant-other',
    defaultCookingMethod: category === 'نوشیدنی' ? null : 'گریل',
    nutrition: { proteinGrams: 0, carbGrams: 0, fatGrams: 0, fiberGrams: null, calories: null },
    ingredients: null,
  }
}

function formFromDish(dish: Dish): NewDishInput {
  return {
    name: dish.name,
    category: dish.category,
    macro: dish.macro,
    costPerServing: dish.costPerServing,
    referencePortionGrams: dish.referencePortionGrams,
    dietaryTags: dish.dietaryTags,
    isBreakfastItem: dish.isBreakfastItem,
    wasteRisk: dish.wasteRisk,
    proteinSource: dish.proteinSource,
    defaultCookingMethod: dish.defaultCookingMethod,
    nutrition: dish.nutrition,
    ingredients: dish.ingredients ?? null,
  }
}

/** پاپ‌آپ فرم غذا — هم برای «افزودن غذای جدید» و هم برای «ویرایش غذای موجود» از همین یک فرم
 * استفاده می‌شود (با props دوگانه‌ی dish/initialCategory) تا تجربه‌ی افزودن و ویرایش کاملاً یکسان
 * باشد. در حالت ویرایش، ذخیره یعنی کاربر کل رکورد را مرور کرده — پس همه‌ی پرچم‌های Verified هم
 * درست مثل addDish روی true تنظیم می‌شوند. */
export function DishFormModal({
  dish,
  initialCategory,
  onClose,
}: {
  dish?: Dish
  initialCategory: Category
  onClose: (savedId?: string) => void
}) {
  const addDish = useAppStore((s) => s.addDish)
  const updateDish = useAppStore((s) => s.updateDish)
  const dishes = useAppStore((s) => s.dishes)
  const ingredientPriceLog = useAppStore((s) => s.ingredientPriceLog)
  const setIngredientPrice = useAppStore((s) => s.setIngredientPrice)
  const customIngredients = useAppStore((s) => s.customIngredients)
  const [form, setForm] = useState<NewDishInput>(() => (dish ? formFromDish(dish) : makeInitialForm(initialCategory)))
  const [costText, setCostText] = useState(dish?.costPerServing ?? 0)
  const [submitted, setSubmitted] = useState(false)
  const [pickedIngredientName, setPickedIngredientName] = useState('')
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [showIngredientDropdown, setShowIngredientDropdown] = useState(false)
  const [newIngredientQuantity, setNewIngredientQuantity] = useState(100)

  const patch = (p: Partial<NewDishInput>) => setForm((f) => ({ ...f, ...p }))

  const macroSum = macroKeys.reduce((s, k) => s + form.macro[k], 0)
  const macroOk = Math.abs(macroSum - 100) < 1
  const nameValid = form.name.trim().length > 0

  const toggleDietaryTag = (tag: DietaryTag) => {
    patch({ dietaryTags: form.dietaryTags.includes(tag) ? form.dietaryTags.filter((t) => t !== tag) : [...form.dietaryTags, tag] })
  }

  // مواد اولیه هرگز از این فرم ویرایش/ذخیره نمی‌شوند — قیمت‌ها مستقیم و بلافاصله در ingredientPriceLog
  // سراسری ثبت می‌شوند (نگاه کنید به setIngredientPrice) تا هم روی همه‌ی غذاهای مشابه اثر بگذارد، هم
  // با بازانتشار دیتابیس غذا پاک نشود. مقدار نمایشی همیشه از effectiveIngredients محاسبه می‌شود.
  const displayIngredients = effectiveIngredients(form.ingredients, ingredientPriceLog)
  const ingredientsCostTotal = effectiveIngredientsCostTotal(form.ingredients, ingredientPriceLog)

  const updateIngredientUnitPrice = (name: string, unitPrice: number) => {
    if (unitPrice > 0) setIngredientPrice(name, unitPrice)
  }

  const applyIngredientsCostAsPrice = () => {
    if (ingredientsCostTotal != null) setCostText(ingredientsCostTotal)
  }

  // فهرست کامل مواد اولیه‌ی شناخته‌شده (از کل دیتابیس غذا + مواد اولیه‌ی دستی) برای منوی «افزودن
  // ماده اولیه» — انتخاب یک نام از این فهرست بلافاصله واحد و آخرین قیمت ثبت‌شده‌اش را می‌آورد،
  // بدون نیاز به تایپ دستی. نگاه کنید به src/lib/ingredients.ts::buildIngredientRows.
  const catalogRows = useMemo(() => buildIngredientRows(dishes, ingredientPriceLog, customIngredients), [dishes, ingredientPriceLog, customIngredients])
  const usedNames = useMemo(() => new Set((form.ingredients ?? []).map((ing) => ing.name)), [form.ingredients])
  const availableToAdd = useMemo(() => catalogRows.filter((r) => !usedNames.has(r.name)), [catalogRows, usedNames])
  const availableByGroup = useMemo(() => {
    const byGroup = new Map<string, typeof availableToAdd>()
    for (const row of availableToAdd) {
      const list = byGroup.get(row.group)
      if (list) list.push(row)
      else byGroup.set(row.group, [row])
    }
    return INGREDIENT_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, rows: byGroup.get(g)! }))
  }, [availableToAdd])

  // فهرست ۲۷۰+ ماده‌ای دیتابیس با یک <select> ساده به‌سختی قابل‌مرور بود — همان الگوی سرچ
  // PickDishModal (جستجوی غذا) اینجا هم برای جستجوی ماده اولیه تکرار شده است.
  const ingredientSearchResults = useMemo(() => {
    const q = ingredientQuery.trim()
    if (!q) return availableByGroup
    return availableByGroup.map(({ group, rows }) => ({ group, rows: rows.filter((r) => r.name.includes(q)) })).filter(({ rows }) => rows.length > 0)
  }, [availableByGroup, ingredientQuery])

  const pickIngredientFromSearch = (name: string) => {
    setPickedIngredientName(name)
    setIngredientQuery(name)
    setShowIngredientDropdown(false)
  }

  const addIngredientRow = () => {
    const row = catalogRows.find((r) => r.name === pickedIngredientName)
    if (!row || newIngredientQuantity <= 0) return
    const newIngredient: Ingredient = {
      name: row.name,
      quantity: newIngredientQuantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      lineTotal: row.unitPrice != null ? row.unitPrice * newIngredientQuantity : null,
    }
    patch({ ingredients: [...(form.ingredients ?? []), newIngredient] })
    setPickedIngredientName('')
    setIngredientQuery('')
    setNewIngredientQuantity(100)
  }

  const removeIngredientRow = (index: number) => {
    patch({ ingredients: (form.ingredients ?? []).filter((_, i) => i !== index) })
  }

  const handleSubmit = () => {
    setSubmitted(true)
    if (!nameValid) return
    const name = form.name.trim()
    const costPerServing = costText > 0 ? costText : null
    if (dish) {
      updateDish(dish.id, {
        name,
        category: form.category,
        macro: form.macro,
        costPerServing,
        needsPrice: costPerServing == null,
        referencePortionGrams: form.referencePortionGrams,
        needsPortionEstimate: false,
        dietaryTags: form.dietaryTags,
        dietaryTagsVerified: true,
        isBreakfastItem: form.isBreakfastItem,
        wasteRisk: form.wasteRisk,
        wasteRiskVerified: true,
        proteinSource: form.proteinSource,
        proteinSourceVerified: true,
        defaultCookingMethod: form.defaultCookingMethod,
        defaultCookingMethodVerified: form.defaultCookingMethod != null,
        nutrition: form.nutrition,
        needsNutritionReview: false,
        ingredients: form.ingredients,
        ingredientsCostTotal: computeIngredientsCostTotal(form.ingredients),
      })
      onClose(dish.id)
    } else {
      const id = addDish({ ...form, name, costPerServing })
      onClose(id)
    }
  }

  return (
    <Modal title={dish ? `ویرایش «${dish.name}»` : 'افزودن غذای جدید'} onClose={() => onClose()}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="نام غذا">
            <input
              type="text"
              autoFocus
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="مثلاً چیکن استراگانف"
              className={`rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 dark:bg-slate-800 dark:text-slate-100 ${
                submitted && !nameValid
                  ? 'border-red-400 focus:border-red-400 focus:ring-red-100 dark:border-red-600'
                  : 'border-slate-300 focus:border-amber-500 focus:ring-amber-100 dark:border-slate-600 dark:focus:ring-amber-900/40'
              }`}
            />
            {submitted && !nameValid && <span className="text-xs text-red-600 dark:text-red-400">نام غذا اجباری است.</span>}
          </Field>
          <Field label="دسته">
            <Select
              value={form.category}
              onChange={(v) => patch({ category: v, defaultCookingMethod: v === 'نوشیدنی' ? null : (form.defaultCookingMethod ?? 'گریل') })}
              options={CATEGORIES}
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">ترکیب ماکرو (٪ از پرس)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {macroKeys.map((k) => (
              <Field key={k} label={macroLabels[k]}>
                <NumberInput value={form.macro[k]} min={0} max={100} onChange={(v) => patch({ macro: { ...form.macro, [k]: v } })} />
              </Field>
            ))}
          </div>
          {!macroOk && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">جمع فعلی {Math.round(macroSum)}٪ است — بهتر است ۱۰۰٪ شود.</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="هزینه هر پرس (ریال)" hint="خالی/صفر بگذارید اگر هنوز قیمت مشخص نیست.">
            <FormattedNumberInput value={costText} onChange={setCostText} />
          </Field>
          <Field label="وزن هر پرس (گرم)">
            <NumberInput value={form.referencePortionGrams} min={0} onChange={(v) => patch({ referencePortionGrams: v })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ریسک هدررفت">
            <Select value={form.wasteRisk} onChange={(v: WasteRisk) => patch({ wasteRisk: v })} options={WASTE_RISK_LEVELS} />
          </Field>
          <Field label="منبع پروتئین غالب">
            <select
              value={form.proteinSource}
              onChange={(e) => patch({ proteinSource: e.target.value as ProteinSourceType })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PROTEIN_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {PROTEIN_SOURCE_LABELS[src]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {form.category !== 'نوشیدنی' && (
          <Field label="روش پخت پیش‌فرض">
            <select
              value={form.defaultCookingMethod ?? NO_COOKING_METHOD}
              onChange={(e) => patch({ defaultCookingMethod: e.target.value === NO_COOKING_METHOD ? null : (e.target.value as CookingMethod) })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {[...COOKING_METHODS, NO_COOKING_METHOD].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Checkbox checked={form.isBreakfastItem} onChange={(v) => patch({ isBreakfastItem: v })} label="مناسب وعده صبحانه" />
          {DIETARY_TAGS.map((tag) => (
            <Checkbox key={tag} checked={form.dietaryTags.includes(tag)} onChange={() => toggleDietaryTag(tag)} label={`برچسب: ${tag}`} />
          ))}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">تغذیه (گرم برای یک پرس مرجع) — اختیاری</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="پروتئین">
              <NumberInput value={form.nutrition.proteinGrams} min={0} onChange={(v) => patch({ nutrition: { ...form.nutrition, proteinGrams: v } })} />
            </Field>
            <Field label="کربوهیدرات">
              <NumberInput value={form.nutrition.carbGrams} min={0} onChange={(v) => patch({ nutrition: { ...form.nutrition, carbGrams: v } })} />
            </Field>
            <Field label="چربی">
              <NumberInput value={form.nutrition.fatGrams} min={0} onChange={(v) => patch({ nutrition: { ...form.nutrition, fatGrams: v } })} />
            </Field>
            <Field label="کالری">
              <NumberInput
                value={form.nutrition.calories ?? 0}
                min={0}
                onChange={(v) => patch({ nutrition: { ...form.nutrition, calories: v || null } })}
              />
            </Field>
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">مواد اولیه (کارت رسپی)</p>
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            فی هر ماده اولیه را ویرایش کنید — بلافاصله ثبت می‌شود و چون قیمت هر ماده مستقل از این غذا نگه‌داری
            می‌شود، روی همه‌ی غذاهای دیگری هم که از همان ماده استفاده می‌کنند اثر می‌گذارد (نگاه کنید به تب
            «مواد اولیه»). این عدد مستقل از «هزینه هر پرس» بالاست، مگر اینکه با دکمه‌ی زیر آن را جایگزین کنید.
          </p>

          {displayIngredients.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-start text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 text-start">نام ماده اولیه</th>
                    <th className="px-3 py-2 text-start">مقدار</th>
                    <th className="px-3 py-2 text-start">فی (ریال)</th>
                    <th className="px-3 py-2 text-start">جمع</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {displayIngredients.map((ing: Ingredient, i) => (
                    <tr key={`${ing.name}-${i}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{ing.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {ing.quantity} {ing.unit}
                      </td>
                      <td className="px-3 py-2">
                        <FormattedNumberInput value={ing.unitPrice ?? 0} className="w-28" onChange={(v) => updateIngredientUnitPrice(ing.name, v)} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {ing.lineTotal != null ? formatRial(ing.lineTotal) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeIngredientRow(i)}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
              هنوز ماده اولیه‌ای برای این غذا ثبت نشده.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
            <Field label="افزودن ماده اولیه">
              <div className="relative w-56">
                <input
                  type="text"
                  value={ingredientQuery}
                  onChange={(e) => {
                    setIngredientQuery(e.target.value)
                    setPickedIngredientName('')
                    setShowIngredientDropdown(true)
                  }}
                  onFocus={() => setShowIngredientDropdown(true)}
                  onBlur={() => window.setTimeout(() => setShowIngredientDropdown(false), 150)}
                  placeholder="جستجوی ماده اولیه…"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                {showIngredientDropdown && (
                  <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {ingredientSearchResults.length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">ماده‌ای یافت نشد</p>
                    )}
                    {ingredientSearchResults.map(({ group, rows }) => (
                      <div key={group}>
                        <p className="bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">{group}</p>
                        {rows.map((r) => (
                          <button
                            key={r.name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickIngredientFromSearch(r.name)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-amber-50 dark:hover:bg-slate-700"
                          >
                            <span className="text-slate-700 dark:text-slate-300">{r.name}</span>
                            <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                              {r.unit}
                              {r.unitPrice != null ? `، ${formatRial(r.unitPrice)}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="مقدار">
              <NumberInput value={newIngredientQuantity} min={0} onChange={setNewIngredientQuantity} className="w-28" />
            </Field>
            <Button variant="outline" size="sm" onClick={addIngredientRow} disabled={!pickedIngredientName || newIngredientQuantity <= 0}>
              + افزودن
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              جمع بهای مواد اولیه: <span className="font-semibold text-slate-800 dark:text-slate-200">{ingredientsCostTotal != null ? formatRial(ingredientsCostTotal) : '—'}</span>
            </span>
            <Button variant="outline" size="sm" onClick={applyIngredientsCostAsPrice} disabled={ingredientsCostTotal == null}>
              استفاده از این مبلغ به‌عنوان قیمت غذا
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button variant="outline" onClick={() => onClose()}>
            انصراف
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            {dish ? 'ذخیره تغییرات' : 'افزودن غذا'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
