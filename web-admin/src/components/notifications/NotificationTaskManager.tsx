import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createScheduledNotificationTask,
  deleteScheduledNotificationTask,
  getScheduledNotificationTasks,
  type ScheduledNotificationTaskPayload,
  updateScheduledNotificationTask,
} from '../../api/admin'
import { parseApiError } from '../../api/error'
import { Panel } from '../Panel'
import { TableSearchInput } from '../TableSearchInput'
import { useToast } from '../../hooks/useToast'
import type { AdminUser, Employee, ScheduledNotificationTask } from '../../types/api'

type TaskFormState = {
  id: number | null
  name: string
  title: string
  message: string
  target: 'employees' | 'admins' | 'both'
  employee_scope: 'all' | 'selected'
  admin_scope: 'all' | 'selected'
  employee_ids: number[]
  admin_user_ids: number[]
  schedule_kind: 'once' | 'daily'
  run_date_local: string
  run_time_local: string
  is_active: boolean
}

function todayDateValue(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function defaultFormState(): TaskFormState {
  return {
    id: null,
    name: '',
    title: '',
    message: '',
    target: 'employees',
    employee_scope: 'all',
    admin_scope: 'all',
    employee_ids: [],
    admin_user_ids: [],
    schedule_kind: 'once',
    run_date_local: todayDateValue(),
    run_time_local: '09:00',
    is_active: true,
  }
}

function dt(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function targetLabel(task: ScheduledNotificationTask): string {
  if (task.target === 'both') return 'Çalışan + Admin'
  if (task.target === 'admins') return 'Admin'
  return 'Çalışan'
}

function scopeLabel(scope: 'all' | 'selected' | null, unit: string): string {
  if (scope === 'all') return `Tüm ${unit}`
  if (scope === 'selected') return `Seçili ${unit}`
  return '-'
}

function scheduleLabel(task: ScheduledNotificationTask): string {
  if (task.schedule_kind === 'daily') {
    return `Her gün ${task.run_time_local.slice(0, 5)}`
  }
  return `${task.run_date_local ?? '-'} ${task.run_time_local.slice(0, 5)}`
}

function taskToFormState(task: ScheduledNotificationTask): TaskFormState {
  return {
    id: task.id,
    name: task.name,
    title: task.title,
    message: task.message,
    target: task.target,
    employee_scope: task.employee_scope ?? 'all',
    admin_scope: task.admin_scope ?? 'all',
    employee_ids: task.employee_ids,
    admin_user_ids: task.admin_user_ids,
    schedule_kind: task.schedule_kind,
    run_date_local: task.run_date_local ?? todayDateValue(),
    run_time_local: task.run_time_local.slice(0, 5),
    is_active: task.is_active,
  }
}

function buildPayload(form: TaskFormState): ScheduledNotificationTaskPayload {
  return {
    name: form.name.trim(),
    title: form.title.trim(),
    message: form.message.trim(),
    target: form.target,
    employee_scope: form.target !== 'admins' ? form.employee_scope : null,
    admin_scope: form.target !== 'employees' ? form.admin_scope : null,
    employee_ids: form.target !== 'admins' && form.employee_scope === 'selected' ? form.employee_ids : [],
    admin_user_ids: form.target !== 'employees' && form.admin_scope === 'selected' ? form.admin_user_ids : [],
    schedule_kind: form.schedule_kind,
    run_date_local: form.schedule_kind === 'once' ? form.run_date_local : null,
    run_time_local: form.run_time_local,
    timezone_name: 'Europe/Istanbul',
    is_active: form.is_active,
  }
}

export function NotificationTaskManager({
  employees,
  admins,
}: {
  employees: Employee[]
  admins: AdminUser[]
}) {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [form, setForm] = useState<TaskFormState>(defaultFormState())
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [adminSearch, setAdminSearch] = useState('')

  const tasksQuery = useQuery({
    queryKey: ['scheduled-notification-tasks'],
    queryFn: () => getScheduledNotificationTasks(),
    refetchInterval: 15000,
  })

  const employeeNameMap = useMemo(
    () => new Map(employees.map((item) => [item.id, item.full_name])),
    [employees],
  )
  const adminNameMap = useMemo(
    () => new Map(admins.map((item) => [item.id, item.username])),
    [admins],
  )

  const filteredEmployees = useMemo(() => {
    const normalized = employeeSearch.trim().toLocaleLowerCase('tr-TR')
    if (!normalized) return employees.slice(0, 120)
    return employees
      .filter((item) => `${item.full_name} ${item.id}`.toLocaleLowerCase('tr-TR').includes(normalized))
      .slice(0, 120)
  }, [employeeSearch, employees])

  const filteredAdmins = useMemo(() => {
    const normalized = adminSearch.trim().toLocaleLowerCase('tr-TR')
    if (!normalized) return admins.slice(0, 80)
    return admins
      .filter((item) => `${item.username} ${item.id}`.toLocaleLowerCase('tr-TR').includes(normalized))
      .slice(0, 80)
  }, [adminSearch, admins])

  const saveMutation = useMutation({
    mutationFn: async (state: TaskFormState) => {
      const payload = buildPayload(state)
      if (state.id != null) {
        return updateScheduledNotificationTask(state.id, payload)
      }
      return createScheduledNotificationTask(payload)
    },
    onSuccess: (_, state) => {
      pushToast({
        variant: 'success',
        title: state.id != null ? 'Görev güncellendi' : 'Görev oluşturuldu',
        description: 'Zamanlanmış bildirim görevi sisteme kaydedildi.',
      })
      setForm(defaultFormState())
      setEmployeeSearch('')
      setAdminSearch('')
      void queryClient.invalidateQueries({ queryKey: ['scheduled-notification-tasks'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Görev kaydedilemedi.')
      pushToast({ variant: 'error', title: 'Görev hatası', description: parsed.message })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteScheduledNotificationTask,
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Görev silindi', description: 'Zamanlanmış görev kaldırıldı.' })
      if (form.id != null) {
        setForm(defaultFormState())
      }
      void queryClient.invalidateQueries({ queryKey: ['scheduled-notification-tasks'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Görev silinemedi.')
      pushToast({ variant: 'error', title: 'Silme hatası', description: parsed.message })
    },
  })

  const taskRows = tasksQuery.data?.items ?? []

  return (
    <>
      <Panel>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void saveMutation.mutateAsync(form)
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Zamanlanmış Bildirim Görevleri</h4>
              <p className="mt-1 text-sm text-slate-500">
                Tek seferlik veya her gün tekrarlayan görev tanımlayın. Tüm çalışanlar, tek kişi veya seçili liste için kullanılabilir.
              </p>
            </div>
            {form.id != null ? (
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setForm(defaultFormState())}
              >
                Düzenlemeyi temizle
              </button>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm text-slate-700">
              Görev adı
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                placeholder="Örn: Sabah bilgilendirmesi"
              />
            </label>
            <label className="text-sm text-slate-700">
              Bildirim başlığı
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                placeholder="Başlık"
              />
            </label>
            <label className="text-sm text-slate-700">
              Hedef
              <select
                value={form.target}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    target: event.target.value as TaskFormState['target'],
                  }))
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="employees">Çalışanlar</option>
                <option value="admins">Adminler</option>
                <option value="both">Her ikisi</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
              />
              Aktif görev
            </label>
          </div>

          <label className="block text-sm text-slate-700">
            Bildirim mesajı
            <textarea
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              rows={4}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              placeholder="Gönderilecek mesaj"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-slate-700">
              Plan tipi
              <select
                value={form.schedule_kind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    schedule_kind: event.target.value as TaskFormState['schedule_kind'],
                  }))
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="once">Tek sefer</option>
                <option value="daily">Her gün</option>
              </select>
            </label>
            {form.schedule_kind === 'once' ? (
              <label className="text-sm text-slate-700">
                Gönderim tarihi
                <input
                  type="date"
                  value={form.run_date_local}
                  onChange={(event) => setForm((current) => ({ ...current, run_date_local: event.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                />
              </label>
            ) : (
              <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                Bu görev her gün aynı saatte çalışır.
              </div>
            )}
            <label className="text-sm text-slate-700">
              Gönderim saati
              <input
                type="time"
                value={form.run_time_local}
                onChange={(event) => setForm((current) => ({ ...current, run_time_local: event.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          {form.target !== 'admins' ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-slate-900">Çalışan hedefi</h5>
                  <p className="text-xs text-slate-500">Tek çalışan için bir kişi, seçili grup için birden fazla kişi işaretleyin.</p>
                </div>
                <select
                  value={form.employee_scope}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      employee_scope: event.target.value as TaskFormState['employee_scope'],
                      employee_ids: event.target.value === 'all' ? [] : current.employee_ids,
                    }))
                  }
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="all">Tüm çalışanlar</option>
                  <option value="selected">Seçili çalışanlar</option>
                </select>
              </div>

              {form.employee_scope === 'selected' ? (
                <div className="mt-3">
                  <TableSearchInput value={employeeSearch} onChange={setEmployeeSearch} placeholder="Çalışan ara..." />
                  <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
                    {filteredEmployees.map((employee) => (
                      <label key={employee.id} className="flex items-center justify-between gap-3 py-1">
                        <span>#{employee.id} - {employee.full_name}</span>
                        <input
                          type="checkbox"
                          checked={form.employee_ids.includes(employee.id)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              employee_ids: current.employee_ids.includes(employee.id)
                                ? current.employee_ids.filter((value) => value !== employee.id)
                                : [...current.employee_ids, employee.id],
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Seçili çalışan sayısı: {form.employee_ids.length}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {form.target !== 'employees' ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-slate-900">Admin hedefi</h5>
                  <p className="text-xs text-slate-500">İsterseniz tüm adminlere, isterseniz seçili adminlere görev oluşturabilirsiniz.</p>
                </div>
                <select
                  value={form.admin_scope}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      admin_scope: event.target.value as TaskFormState['admin_scope'],
                      admin_user_ids: event.target.value === 'all' ? [] : current.admin_user_ids,
                    }))
                  }
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="all">Tüm adminler</option>
                  <option value="selected">Seçili adminler</option>
                </select>
              </div>

              {form.admin_scope === 'selected' ? (
                <div className="mt-3">
                  <TableSearchInput value={adminSearch} onChange={setAdminSearch} placeholder="Admin ara..." />
                  <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
                    {filteredAdmins.map((admin) => (
                      <label key={admin.id} className="flex items-center justify-between gap-3 py-1">
                        <span>#{admin.id} - {admin.username}</span>
                        <input
                          type="checkbox"
                          checked={form.admin_user_ids.includes(admin.id)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              admin_user_ids: current.admin_user_ids.includes(admin.id)
                                ? current.admin_user_ids.filter((value) => value !== admin.id)
                                : [...current.admin_user_ids, admin.id],
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Seçili admin sayısı: {form.admin_user_ids.length}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            >
              {saveMutation.isPending ? 'Kaydediliyor...' : form.id != null ? 'Görevi güncelle' : 'Görev oluştur'}
            </button>
            <span className="text-xs text-slate-500">
              Bugün herkese gönderim için: Tek sefer + bugünün tarihi + tüm çalışanlar.
            </span>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Kayıtlı görevler</h4>
            <p className="mt-1 text-sm text-slate-500">
              Sisteme tanımlanan bildirim görevleri burada görünür. Worker zamanı geldiğinde bunları otomatik kuyruğa alır.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            Toplam: {tasksQuery.data?.total ?? 0}
          </span>
        </div>

        {tasksQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Görevler yükleniyor...</p>
        ) : tasksQuery.isError ? (
          <p className="mt-4 text-sm text-rose-600">Görev listesi alınamadı.</p>
        ) : taskRows.length ? (
          <div className="mt-4 space-y-3">
            {taskRows.map((task) => {
              const selectedEmployeeNames = task.employee_ids
                .map((id) => employeeNameMap.get(id) ?? `#${id}`)
                .slice(0, 3)
              const selectedAdminNames = task.admin_user_ids
                .map((id) => adminNameMap.get(id) ?? `#${id}`)
                .slice(0, 3)

              return (
                <article key={task.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="text-sm font-semibold text-slate-900">{task.name}</h5>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${task.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {task.is_active ? 'Aktif' : 'Pasif'}
                        </span>
                        <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                          {targetLabel(task)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{task.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{task.message}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                        onClick={() => setForm(taskToFormState(task))}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        disabled={deleteMutation.isPending}
                        className="rounded border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
                        onClick={() => {
                          if (window.confirm(`"${task.name}" görevini silmek istiyor musunuz?`)) {
                            void deleteMutation.mutateAsync(task.id)
                          }
                        }}
                      >
                        Sil
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <strong className="block text-slate-900">Plan</strong>
                      {scheduleLabel(task)}
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <strong className="block text-slate-900">Sonraki çalışma</strong>
                      {dt(task.next_run_at_utc)}
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <strong className="block text-slate-900">Çalışan hedefi</strong>
                      {scopeLabel(task.employee_scope, 'çalışan')}
                      {selectedEmployeeNames.length ? (
                        <div className="mt-1 text-xs text-slate-500">{selectedEmployeeNames.join(', ')}</div>
                      ) : null}
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <strong className="block text-slate-900">Admin hedefi</strong>
                      {scopeLabel(task.admin_scope, 'admin')}
                      {selectedAdminNames.length ? (
                        <div className="mt-1 text-xs text-slate-500">{selectedAdminNames.join(', ')}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-500">
                    Son kuyruk tarihi: {task.last_enqueued_at_utc ? dt(task.last_enqueued_at_utc) : '-'}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Henüz kayıtlı görev bulunmuyor.</p>
        )}
      </Panel>
    </>
  )
}
