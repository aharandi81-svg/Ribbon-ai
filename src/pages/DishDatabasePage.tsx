import { useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Button, Card, Checkbox, ConfirmButton, NumberInput, Select, WarningBadge } from '../components/ui'
import { DishFormModal } from '../components/DishFormModal'
import { CATEGORIES, DIETARY_TAGS, DISH_CONSTRAINT_TYPES, PROTEIN_SOURCE_LABELS } from '../types'
import type { Category, DietaryTag, Dish, DishConstraintType, MacroKey } from '../types'
import { formatRial } from '../lib/format'
import { macroAlignmentScore } from '../lib/calculations'
import { setDishConstraintLabel } from '../lib/menuOptimizer'
import { exportDishesToXlsx, importDishesFromFile } from '../lib/dishExcel'
import type { ExportResult, ImportResult } from '../lib/dishExcel'

const ALL = 'همه' as const
const dietaryFilterOptions = [ALL, ...DIETARY_TAGS] as const
const macroKeys: MacroKey[] = ['carb', 'protein', 'veg', 'fat']
const macroLabels: Record<MacroKey, string> = { carb: 'کربوهیدرات', protein: 'پروتئین', veg: 'سبزیجات', fat: 'چربی' }
const NO_CONSTRAINT = 'بدون محدودیت' as const
const constraintOptions = [NO_CONSTRAINT, ...DISH_CONSTRAINT_TYPES] as const

export function DishDatabasePage() {
  const dishes = useAppStore((s) => s.dishes)
  const plan = useAppStore((s) => s.plan)
  const settings = useAppStore((s) => s.settings)
  const setDishConstraint = useAppStore((s) => s.setDishConstraint)
  const upsertDishes = useAppStore((s) => s.upsertDishes)
  const bulkAdjustPrices = useAppStore((s) => s.bulkAdjustPrices)
  const removeDish = useAppStore((s) => s.removeDish)
  const removeDishes = useAppStore((s) => s.removeDishes)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<Category | typeof ALL>(ALL)
  const [dietaryFilter, setDietaryFilter] = useState<DietaryTag | typeof ALL>(ALL)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [bulkPercent, setBulkPercent] = useState(0)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const dishIdsInPlan = useMemo(() => new Set(plan.selectedItems.map((it) => it.dishId)), [plan.selectedItems])

  const filtered = useMemo(() => {
    return dishes.filter((d) => {
      if (categoryFilter !== ALL && d.category !== categoryFilter) return false
      if (dietaryFilter !== ALL && !d.dietaryTags.includes(dietaryFilter)) return false
      if (search.trim() && !d.name.includes(search.trim())) return false
      return true
    })
  }, [dishes, search, categoryFilter, dietaryFilter])

  const handleExport = async () => {
    setExportMessage(null)
    const result: ExportResult = await exportDishesToXlsx(dishes)
    if (result.status === 'saved') setExportMessage('فایل با موفقیت ذخیره شد.')
    else if (result.status === 'fallback-download') setExportMessage('دانلود فایل اکسل آغاز شد.')
    else if (result.status === 'declined') setExportMessage('ذخیره فایل لغو شد.')
    else setExportMessage(result.message ?? 'ذخیره فایل ناموفق بود.')
  }

  const handleImportFile = async (file: File) => {
    setImportError(null)
    setImportResult(null)
    try {
      const result = await importDishesFromFile(file, dishes)
      upsertDishes(result.updated, result.added)
      setImportResult(result)
    } catch {
      setImportError('خواندن فایل ناموفق بود — مطمئن شوید فایل معتبر است (xlsx/xls/csv) و ستون‌های آن با خروجی «اکسپورت» مطابقت دارد.')
    }
  }

  const handleBulkApply = () => {
    if (bulkPercent === 0) return
    const count = bulkAdjustPrices(bulkPercent)
    const direction = bulkPercent > 0 ? 'افزایش' : 'کاهش'
    setBulkMessage(`قیمت ${count} غذا به میزان ${Math.abs(bulkPercent)}٪ ${direction} یافت.`)
  }

  const addModalCategory = categoryFilter === ALL ? CATEGORIES[0] : categoryFilter

  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))
  const someFilteredSelected = filtered.some((d) => selectedIds.has(d.id))

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev)
        for (const d of filtered) next.delete(d.id)
        return next
      }
      const next = new Set(prev)
      for (const d of filtered) next.add(d.id)
      return next
    })
  }

  const toggleSelectOne = (dishId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(dishId)) next.delete(dishId)
      else next.add(dishId)
      return next
    })
  }

  const handleBulkDelete = () => {
    removeDishes([...selectedIds])
    setSelectedIds(new Set())
  }

  const allDishesSelected = dishes.length > 0 && dishes.every((d) => selectedIds.has(d.id))
  const selectAllInDatabase = () => setSelectedIds(new Set(dishes.map((d) => d.id)))

  return (
    <Card title={`دیتابیس غذاها (${dishes.length} غذا)`}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <input
          type="text"
          placeholder="جستجوی نام غذا…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <Select value={categoryFilter} onChange={setCategoryFilter} options={[ALL, ...CATEGORIES]} />
        <Select value={dietaryFilter} onChange={setDietaryFilter} options={dietaryFilterOptions} />
        <button
          type="button"
          onClick={allDishesSelected ? () => setSelectedIds(new Set()) : selectAllInDatabase}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {allDishesSelected ? 'لغو انتخاب همه' : `✓ انتخاب همه‌ی ${dishes.length} غذای دیتابیس`}
        </button>

        <div className="flex-1" />

        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          + افزودن غذای جدید
        </Button>
        <Button variant="outline" onClick={() => void handleExport()}>
          خروجی اکسل ⬇
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          ورودی از اکسل ⬆
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImportFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {exportMessage && (
        <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">{exportMessage}</div>
      )}
      {importError && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800">{importError}</div>
      )}
      {importResult && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800">
          <p className="font-medium">
            {importResult.updated.length} غذا به‌روزرسانی و {importResult.added.length} غذای جدید اضافه شد.
          </p>
          {importResult.warnings.length > 0 && (
            <ul className="mt-2 flex list-disc flex-col gap-1 ps-4 text-amber-700 dark:text-amber-400">
              {importResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">به‌روزرسانی همه‌ی قیمت‌ها:</span>
        <NumberInput value={bulkPercent} step={1} className="w-24" onChange={setBulkPercent} />
        <span className="text-sm text-slate-500 dark:text-slate-400">٪ (عدد منفی برای کاهش)</span>
        <ConfirmButton
          label="اعمال"
          disabled={bulkPercent === 0}
          confirmMessage={`قیمت هر پرس همه‌ی غذاهایی که هزینه ثبت‌شده دارند به میزان ${Math.abs(bulkPercent)}٪ ${
            bulkPercent > 0 ? 'افزایش' : 'کاهش'
          } می‌یابد.`}
          onConfirm={handleBulkApply}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
        />
        {bulkMessage && <span className="text-sm text-emerald-700 dark:text-emerald-400">{bulkMessage}</span>}
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
          <span className="text-sm font-medium text-amber-900 dark:text-amber-200">{selectedIds.size} غذا انتخاب شده</span>
          <ConfirmButton
            label="حذف غذاهای انتخاب‌شده"
            danger
            confirmMessage={`${selectedIds.size} غذای انتخاب‌شده برای همیشه از دیتابیس حذف می‌شوند${
              [...selectedIds].some((id) => dishIdsInPlan.has(id)) ? ' — برخی از آن‌ها در سناریوی فعلی هم انتخاب شده‌اند و ردیف مربوطه از صفحه «انتخاب غذا» هم حذف می‌شود.' : '.'
            }`}
            confirmLabel="بله، حذف کن"
            onConfirm={handleBulkDelete}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
          />
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            پاک‌کردن انتخاب
          </button>
        </div>
      )}

      {showAddModal && <DishFormModal initialCategory={addModalCategory} onClose={() => setShowAddModal(false)} />}
      {editingDish && (
        <DishFormModal dish={editingDish} initialCategory={editingDish.category} onClose={() => setEditingDish(null)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1750px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="px-2 py-2 text-start">
                <Checkbox checked={allFilteredSelected} onChange={toggleSelectAllFiltered} className={someFilteredSelected && !allFilteredSelected ? 'opacity-70' : ''} />
              </th>
              <th className="px-2 py-2 text-start">نام</th>
              <th className="px-2 py-2 text-start">دسته</th>
              {macroKeys.map((k) => (
                <th key={k} className="px-2 py-2 text-start">
                  {macroLabels[k]} ٪
                </th>
              ))}
              <th className="px-2 py-2" />
              <th className="px-2 py-2 text-start">هزینه هر پرس</th>
              <th className="px-2 py-2 text-start">منبع هزینه</th>
              <th className="px-2 py-2 text-start">وزن هر پرس (گرم)</th>
              <th className="px-2 py-2 text-start">وضعیت قیمت</th>
              <th className="px-2 py-2 text-start">برچسب رژیمی (خودکار)</th>
              <th className="px-2 py-2 text-start">هم‌راستایی با فرمول تقسیم سفره</th>
              <th className="px-2 py-2 text-start">ریسک هدررفت</th>
              <th className="px-2 py-2 text-start">منبع پروتئین غالب</th>
              <th className="px-2 py-2 text-start">روش پخت پیش‌فرض</th>
              <th className="px-2 py-2 text-start">محدودیت موتور بهینه‌سازی منو</th>
              <th className="px-2 py-2 text-start">سهم پوشش مشاهده‌شده</th>
              <th className="px-2 py-2 text-start">رویدادها</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((dish) => {
              const macroSum = macroKeys.reduce((s, k) => s + dish.macro[k], 0)
              const macroOk = Math.abs(macroSum - 100) < 1
              return (
                <tr
                  key={dish.id}
                  className={`border-b border-slate-100 align-top dark:border-slate-800 ${selectedIds.has(dish.id) ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}
                >
                  <td className="px-2 py-2">
                    <Checkbox checked={selectedIds.has(dish.id)} onChange={() => toggleSelectOne(dish.id)} />
                  </td>
                  <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{dish.name}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{dish.category}</td>
                  {macroKeys.map((k) => (
                    <td key={k} className="px-2 py-2 text-slate-600 dark:text-slate-400">
                      {dish.macro[k]}٪
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    {!macroOk && <WarningBadge>جمع {Math.round(macroSum)}٪</WarningBadge>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300">{formatRial(dish.costPerServing)}</td>
                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{dish.costSource}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-400">
                    {dish.referencePortionGrams}
                    {dish.needsPortionEstimate && (
                      <div className="mt-1">
                        <WarningBadge>برآوردی</WarningBadge>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      {dish.needsPrice && <WarningBadge>نیاز به قیمت</WarningBadge>}
                      {dish.priceVarianceFlag && <WarningBadge>پراکندگی قیمت &gt; ۳۰٪</WarningBadge>}
                      {!dish.needsPrice && !dish.priceVarianceFlag && (
                        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRial(dish.costPerServing)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {dish.dietaryTags.length === 0 ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-emerald-700 dark:text-emerald-400">{dish.dietaryTags.join('، ')}</span>
                        {dish.dietaryTagsVerified ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ تأییدشده</span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">تأییدنشده</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {dish.category === 'نوشیدنی' ? (
                      <span className="text-slate-400 dark:text-slate-500">خنثی (نوشیدنی)</span>
                    ) : (
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {Math.round(macroAlignmentScore(dish, settings) * 100)}٪
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-600 dark:text-slate-400">{dish.wasteRisk}</span>
                      {dish.wasteRiskVerified ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ تأییدشده</span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400">حدس خودکار</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-600 dark:text-slate-400">{PROTEIN_SOURCE_LABELS[dish.proteinSource]}</span>
                      {dish.proteinSourceVerified ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ تأییدشده</span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400">حدس خودکار</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {dish.category === 'نوشیدنی' ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-600 dark:text-slate-400">{dish.defaultCookingMethod}</span>
                        {dish.defaultCookingMethodVerified ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ تأییدشده</span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">حدس خودکار</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={plan.dishConstraints[dish.id] ?? NO_CONSTRAINT}
                      onChange={(e) => {
                        const v = e.target.value
                        setDishConstraint(dish.id, v === NO_CONSTRAINT ? null : (v as DishConstraintType))
                      }}
                      className="w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {constraintOptions.map((c) => (
                        <option key={c} value={c}>
                          {c === NO_CONSTRAINT ? c : setDishConstraintLabel(c)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {dish.observedCoveragePercent != null ? (
                      <>
                        {Math.round(dish.observedCoveragePercent * 1000) / 10}٪
                        <div className="text-slate-400 dark:text-slate-500">از {dish.observedEventsRecorded} رویداد</div>
                      </>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">هنوز داده‌ای ثبت نشده</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500">{dish.eventsUsedIn.join('، ') || '—'}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingDish(dish)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        ویرایش
                      </button>
                      <ConfirmButton
                        label="حذف"
                        danger
                        confirmMessage={
                          dishIdsInPlan.has(dish.id)
                            ? `«${dish.name}» در سناریوی فعلی انتخاب شده — حذف آن از دیتابیس، ردیف مربوطه را هم از صفحه «انتخاب غذا» حذف می‌کند.`
                            : `«${dish.name}» برای همیشه از دیتابیس غذا حذف می‌شود.`
                        }
                        confirmLabel="بله، حذف کن"
                        onConfirm={() => removeDish(dish.id)}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={21} className="px-2 py-6 text-center text-slate-400 dark:text-slate-500">
                  غذایی یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
