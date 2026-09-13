import { useEffect, useState } from 'react'
import { EventSettingsPage } from './pages/EventSettingsPage'
import { DishSelectionPage } from './pages/DishSelectionPage'
import { DashboardPage } from './pages/DashboardPage'
import { RecommendationsPage } from './pages/RecommendationsPage'
import { DishDatabasePage } from './pages/DishDatabasePage'
import { IngredientsPage } from './pages/IngredientsPage'
import { FileDatabaseBar } from './components/FileDatabaseBar'
import { MysqlSyncBar } from './components/MysqlSyncBar'

const TABS = [
  { id: 'settings', label: 'تنظیمات رویداد', Component: EventSettingsPage },
  { id: 'selection', label: 'انتخاب غذا', Component: DishSelectionPage },
  { id: 'dashboard', label: 'داشبورد جمع‌بندی', Component: DashboardPage },
  { id: 'recommendations', label: 'توصیه‌های تخصصی', Component: RecommendationsPage },
  { id: 'database', label: 'دیتابیس غذاها', Component: DishDatabasePage },
  { id: 'ingredients', label: 'مواد اولیه', Component: IngredientsPage },
] as const

type TabId = (typeof TABS)[number]['id']
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'buffet-planner-theme'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage غیرقابل‌دسترس (مثلاً حالت خصوصی) — به تنظیم سیستم برمی‌گردیم.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // نبود دسترسی به localStorage نباید کل اپ را متوقف کند — فقط ترجیح ذخیره نمی‌شود.
    }
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('settings')
  const [theme, toggleTheme] = useTheme()
  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.Component ?? EventSettingsPage

  return (
    <div className="min-h-screen">
      <header className="bg-slate-950">
        <div className="flex items-center gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <span aria-hidden className="h-9 w-9 shrink-0 rounded-lg bg-amber-400" />
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              برنامه‌ریز و بهینه‌ساز منوی بوفه رویداد سازمانی
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">همه‌ی محاسبات به‌صورت زنده و سمت مرورگر انجام می‌شود.</p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'حالت روز' : 'حالت شب'}
            title={theme === 'dark' ? 'حالت روز' : 'حالت شب'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-lg text-amber-400 ring-1 ring-slate-800 transition-colors hover:bg-slate-800"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="flex flex-col items-end gap-1.5 px-4 pb-3 sm:px-6 lg:px-8">
          <MysqlSyncBar />
          <FileDatabaseBar />
        </div>
        <div className="h-1 w-full bg-amber-400" />
      </header>

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-900 p-1.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="pb-10">
          <ActiveComponent />
        </main>
      </div>
    </div>
  )
}

export default App
