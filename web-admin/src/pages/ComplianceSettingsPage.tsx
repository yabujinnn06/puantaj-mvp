import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getComplianceSettings,
  type ComplianceSettingsPayload,
  updateComplianceSettings,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'

export function ComplianceSettingsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const settingsQuery = useQuery({
    queryKey: ['compliance-settings'],
    queryFn: getComplianceSettings,
  })

  const [form, setForm] = useState<ComplianceSettingsPayload>({
    name: 'TR_DEFAULT',
    weekly_normal_minutes_default: 2700,
    daily_max_minutes: 660,
    enforce_min_break_rules: false,
    night_work_max_minutes_default: 450,
    night_work_exceptions_note_enabled: true,
    overtime_annual_cap_minutes: 16200,
    overtime_premium: 1.5,
    extra_work_premium: 1.25,
    overtime_rounding_mode: 'OFF',
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setForm({
      name: settingsQuery.data.name,
      weekly_normal_minutes_default: settingsQuery.data.weekly_normal_minutes_default,
      daily_max_minutes: settingsQuery.data.daily_max_minutes,
      enforce_min_break_rules: settingsQuery.data.enforce_min_break_rules,
      night_work_max_minutes_default: settingsQuery.data.night_work_max_minutes_default,
      night_work_exceptions_note_enabled: settingsQuery.data.night_work_exceptions_note_enabled,
      overtime_annual_cap_minutes: settingsQuery.data.overtime_annual_cap_minutes,
      overtime_premium: settingsQuery.data.overtime_premium,
      extra_work_premium: settingsQuery.data.extra_work_premium,
      overtime_rounding_mode: settingsQuery.data.overtime_rounding_mode,
    })
  }, [settingsQuery.data])

  const mutation = useMutation({
    mutationFn: updateComplianceSettings,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Uyumluluk ayarlari guncellendi',
        description: 'Yasal puantaj hesaplama parametreleri kaydedildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['compliance-settings'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-monthly'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Kayit hatasi',
        description: parseApiError(error, 'Ayarlar kaydedilemedi.').message,
      })
    },
  })

  if (settingsQuery.isLoading) return <LoadingBlock />
  if (settingsQuery.isError) {
    return <ErrorBlock message={parseApiError(settingsQuery.error, 'Uyumluluk ayarlari alinamadi.').message} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Uyumluluk Ayarları"
        description="Turk is kanunu varsayimlarini yonetmek için bu ayarlari kullanin."
      />

      <Panel>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(form)
          }}
        >
          <label className="text-sm text-slate-700">
            Profil Adi
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Haftalik Normal Sure (dk)
            <input
              type="number"
              min={1}
              value={form.weekly_normal_minutes_default}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  weekly_normal_minutes_default: Number(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Günlük Azami Sure (dk)
            <input
              type="number"
              min={1}
              value={form.daily_max_minutes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, daily_max_minutes: Number(event.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Gece Azami Sure (dk)
            <input
              type="number"
              min={1}
              value={form.night_work_max_minutes_default}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  night_work_max_minutes_default: Number(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Yillik Fazla Mesai Limiti (dk)
            <input
              type="number"
              min={1}
              value={form.overtime_annual_cap_minutes}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  overtime_annual_cap_minutes: Number(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Fazla Mesai Carpani
            <input
              type="number"
              min={1}
              step="0.01"
              value={form.overtime_premium}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, overtime_premium: Number(event.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ek Calisma Carpani
            <input
              type="number"
              min={1}
              step="0.01"
              value={form.extra_work_premium}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, extra_work_premium: Number(event.target.value) }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Fazla Mesai Yuvarlama
            <select
              value={form.overtime_rounding_mode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  overtime_rounding_mode: event.target.value as ComplianceSettingsPayload['overtime_rounding_mode'],
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="OFF">OFF</option>
              <option value="REG_HALF_HOUR">REG_HALF_HOUR</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={form.enforce_min_break_rules}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, enforce_min_break_rules: event.target.checked }))
              }
            />
            Asgari mola kurallarini uygula (Is Kanunu madde 68)
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={form.night_work_exceptions_note_enabled}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  night_work_exceptions_note_enabled: event.target.checked,
                }))
              }
            />
            Gece calisma istisna notu bayragini aktif tut
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {mutation.isPending ? (
                <>
                  <span className="inline-spinner" aria-hidden="true" />
                  Kaydediliyor...
                </>
              ) : (
                'Ayarları Kaydet'
              )}
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Hizli Özet</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Haftalik normal sure</p>
            <p className="font-semibold">
              <MinuteDisplay minutes={form.weekly_normal_minutes_default} />
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Günlük ust sinir</p>
            <p className="font-semibold">
              <MinuteDisplay minutes={form.daily_max_minutes} />
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Yillik fazla mesai limiti</p>
            <p className="font-semibold">
              <MinuteDisplay minutes={form.overtime_annual_cap_minutes} />
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}

