import { Fragment, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Button, Card, Field, FormattedNumberInput, Modal, Select } from '../components/ui'
import { buildIngredientRows, type IngredientRow } from '../lib/ingredients'
import { INGREDIENT_GROUP_ORDER, FALLBACK_INGREDIENT_GROUP } from '../data/ingredientGroups'
import { formatRial, formatJalaliDateTime } from '../lib/format'

export function IngredientsPage() {
  const dishes = useAppStore((s) => s.dishes)
  const ingredientPriceLog = useAppStore((s) => s.ingredientPriceLog)
  const setIngredientPrice = useAppStore((s) => s.setIngredientPrice)
  const customIngredients = useAppStore((s) => s.customIngredients)
  const addCustomIngredient = useAppStore((s) => s.addCustomIngredient)
  const [search, setSearch] = useState('')
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('گرم')
  const [newGroup, setNewGroup] = useState<string>(FALLBACK_INGREDIENT_GROUP)
  const [newPrice, setNewPrice] = useState(0)
  const [addError, setAddError] = useState<string | null>(null)

  const rows = useMemo(() => buildIngredientRows(dishes, ingredientPriceLog, customIngredients), [dishes, ingredientPriceLog, customIngredients])

  const filtered = useMemo(() => {
    const q = search.trim()
    if (!q) return rows
    return rows.filter((r) => r.name.includes(q) || r.group.includes(q) || r.unit.includes(q))
  }, [rows, search])

  const grouped = useMemo(() => {
    const byGroup = new Map<string, IngredientRow[]>()
    for (const row of filtered) {
      const list = byGroup.get(row.group)
      if (list) list.push(row)
      else byGroup.set(row.group, [row])
    }
    const orderedGroups = [...INGREDIENT_GROUP_ORDER, ...[...byGroup.keys()].filter((g) => !(INGREDIENT_GROUP_ORDER as readonly string[]).includes(g))]
    return orderedGroups.filter((g) => byGroup.has(g)).map((g) => ({ group: g, rows: byGroup.get(g)! }))
  }, [filtered])

  const handlePriceChange = (row: IngredientRow, next: number) => {
    if (next === row.unitPrice) return
    setIngredientPrice(row.name, next)
  }

  const historyEntries = historyFor ? (ingredientPriceLog[historyFor] ?? []) : []

  const resetAddForm = () => {
    setNewName('')
    setNewUnit('گرم')
    setNewGroup(FALLBACK_INGREDIENT_GROUP)
    setNewPrice(0)
    setAddError(null)
  }

  const handleAddIngredient = () => {
    const name = newName.trim()
    if (!name) {
      setAddError('نام ماده اولیه اجباری است.')
      return
    }
    if (rows.some((r) => r.name === name)) {
      setAddError('این ماده اولیه از قبل در فهرست وجود دارد.')
      return
    }
    addCustomIngredient(name, { unit: newUnit.trim() || 'عدد', group: newGroup }, newPrice > 0 ? newPrice : null)
    setShowAddModal(false)
    resetAddForm()
  }

  return (
    <Card title={`مواد اولیه (${rows.length} قلم)`}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <input
          type="text"
          placeholder="جستجو در نام، دسته‌بندی یا واحد…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          قیمت هر ماده اولیه بلافاصله پس از ویرایش روی همه‌ی غذاهایی که از آن استفاده می‌کنند اعمال می‌شود.
        </span>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          + افزودن ماده اولیه جدید
        </Button>
      </div>

      {showAddModal && (
        <Modal
          title="افزودن ماده اولیه جدید"
          onClose={() => {
            setShowAddModal(false)
            resetAddForm()
          }}
        >
          <div className="flex flex-col gap-4">
            <Field label="نام ماده اولیه">
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setAddError(null)
                }}
                placeholder="مثلاً پودر کاری"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              {addError && <span className="text-xs text-red-600 dark:text-red-400">{addError}</span>}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="واحد اندازه‌گیری">
                <input
                  type="text"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="گرم / سی‌سی / عدد"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </Field>
              <Field label="دسته‌بندی">
                <Select value={newGroup} onChange={setNewGroup} options={INGREDIENT_GROUP_ORDER} />
              </Field>
            </div>
            <Field label="قیمت واحد اولیه (ریال)" hint="اختیاری — بعداً هم از همین صفحه قابل ثبت است.">
              <FormattedNumberInput value={newPrice} onChange={setNewPrice} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false)
                  resetAddForm()
                }}
              >
                انصراف
              </Button>
              <Button variant="primary" onClick={handleAddIngredient}>
                افزودن
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`تاریخچه قیمت — ${historyFor}`} onClose={() => setHistoryFor(null)}>
          {historyEntries.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">هنوز هیچ تغییر قیمتی برای این ماده ثبت نشده — قیمت فعلی همان قیمت پایه‌ی کارت رسپی است.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {historyEntries.map((entry, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{formatRial(entry.price)}</span>
                  <span className="text-slate-500 dark:text-slate-400">{formatJalaliDateTime(entry.changedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="px-2 py-2 text-start">نام ماده اولیه</th>
              <th className="px-2 py-2 text-start">واحد</th>
              <th className="px-2 py-2 text-start">تعداد غذاهای استفاده‌کننده</th>
              <th className="px-2 py-2 text-start">قیمت واحد فعلی (ریال)</th>
              <th className="px-2 py-2 text-start">آخرین تغییر قیمت</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ group, rows: groupRows }) => (
              <Fragment key={group}>
                <tr className="bg-slate-50 dark:bg-slate-800/60">
                  <td colSpan={6} className="px-2 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                    {group} ({groupRows.length})
                  </td>
                </tr>
                {groupRows.map((row) => (
                  <tr key={row.name} className="border-b border-slate-100 align-middle dark:border-slate-800">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{row.name}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{row.unit || '—'}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{row.dishCount}</td>
                    <td className="px-2 py-2">
                      <FormattedNumberInput
                        value={row.unitPrice ?? 0}
                        onChange={(next) => handlePriceChange(row, next)}
                        className="w-32"
                      />
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">{formatJalaliDateTime(row.lastChangedAt)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setHistoryFor(row.name)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        تاریخچه قیمت
                      </button>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-400 dark:text-slate-500">
                  ماده اولیه‌ای یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
