import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { buildDishesById } from '../data/dishes'
import { computeAllItemCalcs } from '../lib/calculations'
import { AccentLabel, Button, Card, WarningBadge } from '../components/ui'
import { EditSelectedItemModal, PickDishModal } from '../components/DishSelectionModals'
import { MenuOptimizerPanel } from '../components/MenuOptimizerPanel'
import { CATEGORIES, mealTypeIncludesBreakfast, mealTypeIncludesLunchOrDinner } from '../types'
import type { Category, Dish, SelectedItem } from '../types'
import { formatNumber, formatRial } from '../lib/format'

export function DishSelectionPage() {
  const plan = useAppStore((s) => s.plan)
  const settings = useAppStore((s) => s.settings)
  const dishes = useAppStore((s) => s.dishes)
  const addSelectedItem = useAppStore((s) => s.addSelectedItem)
  const removeSelectedItem = useAppStore((s) => s.removeSelectedItem)

  const dishesById = useMemo(() => buildDishesById(dishes), [dishes])
  const itemCalcs = useMemo(() => computeAllItemCalcs(plan, dishesById, settings), [plan, dishesById, settings])
  const calcByItemId = useMemo(() => new Map(itemCalcs.map((c) => [c.itemId, c])), [itemCalcs])

  const showBreakfast = mealTypeIncludesBreakfast(plan.mealType)
  const showLunchDinner = mealTypeIncludesLunchOrDinner(plan.mealType)
  const [showFormula, setShowFormula] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [pickerCategory, setPickerCategory] = useState<Category | null>(null)

  const editingItem = editingItemId != null ? plan.selectedItems.find((it) => it.itemId === editingItemId) : undefined
  const editingDish = editingItem ? dishesById.get(editingItem.dishId) : undefined

  return (
    <div className="flex flex-col gap-6">
      <MenuOptimizerPanel />

      <Card className="bg-slate-50 dark:bg-slate-800/40">
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300"
        >
          <AccentLabel>فرمول محاسبه سهم پوشش و تعداد پخت</AccentLabel>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{showFormula ? '▲ بستن' : '▼ نمایش توضیح کامل'}</span>
        </button>
        {showFormula && (
          <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
            <strong>سهم پوشش</strong> دیگر عددی نیست که شما وارد کنید — با هر بار افزودن/حذف غذا در یک دسته، خودِ سیستم
            آن را بازمحاسبه می‌کند و از دو عامل تشکیل می‌شود: (۱) وزن تقاضا — اگر از رویدادهای قبلی برای همان غذا مصرف
            واقعی ثبت شده باشد از آن استفاده می‌شود، وگرنه پیش‌فرض رده انتخابی؛ (۲) <strong>هم‌راستایی با فرمول تقسیم
            سفره</strong> — هرچه ترکیب ماکروی خودِ غذا (کربوهیدرات/پروتئین/سبزیجات) به استاندارد تغذیه‌ای ۲۵٪/۲۵٪/۵۰٪
            نزدیک‌تر باشد، در ازای همان تقاضا سهم بیشتری می‌گیرد (نوشیدنی از این معیار مستثناست). حاصل‌ضرب این دو عامل
            بین همه‌ی غذاهای همان دسته نرمال‌سازی می‌شود — یعنی افزودن یک گزینه‌ی جدید، سهم بقیه‌ی گزینه‌های همان دسته
            را خودکار کم می‌کند (چون مجموعاً حدود یک «پرس معادل» به ازای هر مهمان بین گزینه‌های یک دسته تقسیم می‌شود،
            نه اینکه هر غذا مستقل از بقیه پیش‌بینی شود). از آن‌جا: تعداد نفر = تعداد میهمانان × نرخ حضور مورد انتظار ×
            سهم پوشش، و روی این عدد یک{' '}
            <strong>ذخیره‌ی احتیاطی</strong> اضافه می‌شود که اندازه‌اش به ریسک هدررفت خودِ غذا بستگی دارد: غذای
            فسادپذیر ذخیره‌ی کمتر می‌گیرد چون پرس اضافه‌اش هدر می‌رود، غذای قابل‌نگهداری (نوشیدنی/دسر بسته‌بندی)
            ذخیره‌ی بیشتری می‌گیرد چون کمبودش گران‌تر تمام می‌شود. جمع این دو = <strong>تعداد پخت</strong>. توصیه‌ی
            عملیاتی: بخش «قطعی» را از قبل بپزید و ذخیره‌ی احتیاطیِ غذای فسادپذیر را آماده ولی نپخته نگه دارید تا فقط
            در صورت نیاز واقعی تکمیل شود.
          </p>
        )}
      </Card>

      {CATEGORIES.map((category) => (
        <CategorySection
          key={category}
          category={category}
          dishes={dishes}
          plan={plan}
          selectedItems={plan.selectedItems.filter((it) => dishesById.get(it.dishId)?.category === category)}
          calcByItemId={calcByItemId}
          onEdit={(itemId) => setEditingItemId(itemId)}
          onRemove={removeSelectedItem}
          onOpenPicker={() => setPickerCategory(category)}
        />
      ))}

      {editingItem && editingDish && (
        <EditSelectedItemModal item={editingItem} dish={editingDish} category={editingDish.category} onClose={() => setEditingItemId(null)} />
      )}

      {pickerCategory &&
        (() => {
          const relevantDishes =
            pickerCategory === 'نوشیدنی' ? dishes : dishes.filter((d) => (d.isBreakfastItem ? showBreakfast : showLunchDinner))
          const isRestricted = relevantDishes.length < dishes.filter((d) => d.category === pickerCategory).length
          return (
            <PickDishModal
              category={pickerCategory}
              dishes={relevantDishes}
              restrictedNote={
                isRestricted
                  ? `فقط غذاهای مرتبط با «${plan.mealType}» نشان داده می‌شوند — نوع وعده را از تنظیمات رویداد عوض کنید تا فهرست کامل دیده شود.`
                  : undefined
              }
              onAdd={(dishId) => addSelectedItem(pickerCategory, dishId)}
              onClose={() => setPickerCategory(null)}
            />
          )
        })()}
    </div>
  )
}

function CategorySection({
  category,
  dishes,
  plan,
  selectedItems,
  calcByItemId,
  onEdit,
  onRemove,
  onOpenPicker,
}: {
  category: Category
  dishes: Dish[]
  plan: ReturnType<typeof useAppStore.getState>['plan']
  selectedItems: SelectedItem[]
  calcByItemId: Map<string, ReturnType<typeof computeAllItemCalcs>[number]>
  onEdit: (itemId: string) => void
  onRemove: (itemId: string) => void
  onOpenPicker: () => void
}) {
  const showCookingMethod = category !== 'نوشیدنی'

  return (
    <Card
      title={
        <div className="flex flex-1 items-center justify-between gap-2">
          <span>{category}</span>
          <Button variant="outline" size="sm" onClick={onOpenPicker}>
            + افزودن غذا
          </Button>
        </div>
      }
    >
      {selectedItems.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">هنوز غذایی برای این دسته انتخاب نشده.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-2 py-2 text-start">غذا</th>
                <th className="px-2 py-2 text-start">رده</th>
                <th className="px-2 py-2 text-start">سهم پوشش (خودکار)</th>
                <th className="px-2 py-2 text-start">اندازه پرس (گرم)</th>
                {showCookingMethod && <th className="px-2 py-2 text-start">روش پخت</th>}
                <th className="px-2 py-2 text-start">هزینه هر پرس</th>
                <th className="px-2 py-2 text-start">سهم بودجه</th>
                <th className="px-2 py-2 text-start">وضعیت بودجه</th>
                <th className="px-2 py-2 text-start">تعداد پخت</th>
                <th className="px-2 py-2 text-start">ریسک هدررفت</th>
                <th className="px-2 py-2 text-start">حداکثر قابل‌خرید</th>
                <th className="px-2 py-2 text-start">هزینه کل</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {selectedItems.map((item) => {
                const dish = dishes.find((d) => d.id === item.dishId)
                const calc = calcByItemId.get(item.itemId)
                if (!dish || !calc) return null
                const over = calc.overBudget
                return (
                  <tr key={item.itemId} className="border-b border-slate-100 align-top dark:border-slate-800">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">
                      {dish.name}
                      {dish.dietaryTags.length > 0 && (
                        <span
                          className="ms-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"
                          title="تشخیص خودکار و تأییدنشده — پیش از اعلام به مهمانان بازبینی دستی کنید"
                        >
                          ({dish.dietaryTags.join('/')} — تأییدنشده)
                        </span>
                      )}
                      {dish.needsPrice && (
                        <div className="mt-1">
                          <WarningBadge>نیاز به قیمت</WarningBadge>
                        </div>
                      )}
                      {dish.priceVarianceFlag && (
                        <div className="mt-1">
                          <WarningBadge>پراکندگی قیمت بالا</WarningBadge>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{item.tier}</td>
                    <td className="px-2 py-2">
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100">{Math.round(calc.coveragePercent * 1000) / 10}٪</span>
                      <p className="mt-1 max-w-[10rem] text-xs text-slate-400 dark:text-slate-500">
                        = {formatNumber(calc.coverageCount)} نفر ({plan.guestCount} × {Math.round(plan.expectedAttendanceRate * 100)}٪ × {Math.round(calc.coveragePercent * 100)}٪) — خودکار، از نسبت وزن این غذا به کل دسته
                      </p>
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">
                      {item.portionSize}
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        مرجع: {dish.referencePortionGrams} گرم
                        {dish.needsPortionEstimate && ' (برآوردی)'}
                      </p>
                    </td>
                    {showCookingMethod && <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{item.cookingMethod ?? '—'}</td>}
                    <td className="px-2 py-2 whitespace-nowrap">{formatRial(calc.effectiveCostPerServing)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatRial(calc.budgetShare)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          dish.needsPrice
                            ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            : over
                              ? 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800'
                              : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800'
                        }`}
                      >
                        {dish.needsPrice ? 'نامشخص' : over ? 'خارج از بودجه' : 'در بودجه'}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-medium">{formatNumber(calc.batchQuantity)}</span>
                      {calc.reserveQuantity > 0 && (
                        <p className="mt-1 max-w-[10rem] text-xs text-slate-400 dark:text-slate-500">
                          قطعی {formatNumber(calc.coverageCount)} + ذخیره {formatNumber(calc.reserveQuantity)}{' '}
                          {dish.wasteRisk === 'فسادپذیر' ? '(آماده ولی نپخته نگه دارید)' : '(از قبل کامل آماده کنید)'}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {calc.wasteRiskAmount != null && calc.wasteRiskAmount > 0 ? (
                        <span className="text-amber-700 dark:text-amber-400">{formatRial(calc.wasteRiskAmount)}</span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{calc.maxAffordableQty != null ? formatNumber(calc.maxAffordableQty) : '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-medium">{formatRial(calc.totalItemCost)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEdit(item.itemId)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          ویرایش
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(item.itemId)}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
