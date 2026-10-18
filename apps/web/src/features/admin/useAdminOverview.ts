/**
 * خطاف كونسول الإدارة — يجلب الإحصائيات الشاملة بالفلتر الحالي، ويعيد الجلب
 * تلقائيًا عندما تتغيّر بيانات المخزن الرطب (حصة جديدة/إلغاء/إنهاء).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { getStoreVersion, subscribeStore } from '../../lib/data/eduStore'
import { ApiError } from '../../lib/apiClient'
import { fetchOverview, fetchTeacherDetail, type Overview, type OverviewFilters, type TeacherDetail } from './api'

export function useAdminOverview(filters: OverviewFilters) {
  // إصدار المخزن داخل الفلاتر: أي تحديث بيانات من الخادم يعيد الجلب
  const version = useSyncExternalStore(subscribeStore, getStoreVersion)
  const key = useMemo(() => JSON.stringify(filters), [filters])

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchOverview(JSON.parse(key) as OverviewFilters))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تحميل الإحصائيات.')
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    void load()
  }, [load, version])

  return { data, loading, error, reload: load }
}

export function useTeacherDrill(teacherId: number | null, range: { from?: number; to?: number }) {
  const [data, setData] = useState<TeacherDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (teacherId === null) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetchTeacherDetail(teacherId, range)
      .then((rows) => {
        if (alive) setData(rows)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : 'تعذّر تحميل تفاصيل المدرس.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, range.from, range.to])

  return { data, loading, error }
}
