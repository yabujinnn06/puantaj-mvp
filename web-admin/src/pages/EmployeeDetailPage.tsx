import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import {
  createDeviceInvite,
  getDepartmentShifts,
  getEmployeeLocation,
  getEmployees,
  updateEmployeeActive,
  updateEmployeeShift,
  upsertEmployeeLocation,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { CopyField } from '../components/CopyField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'

const locationSchema = z.object({
  home_lat: z.coerce.number().min(-90),
  home_lon: z.coerce.number().min(-180),
  radius_m: z.coerce.number().int().positive().max(2000),
})

const inviteSchema = z.object({
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

export function EmployeeDetailPage() {
  const params = useParams()
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const employeeId = Number(params.id)

  const [homeLat, setHomeLat] = useState('41.0')
  const [homeLon, setHomeLon] = useState('29.0')
  const [radiusM, setRadiusM] = useState('120')
  const [formError, setFormError] = useState<string | null>(null)

  const [isInviteModalOpen, setInviteModalOpen] = useState(false)
  const [expiresInMinutes, setExpiresInMinutes] = useState('60')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const [selectedShiftId, setSelectedShiftId] = useState('')

  const employeesQuery = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => getEmployees({ status: 'all' }),
  })
  const locationQuery = useQuery({
    queryKey: ['employee-location', employeeId],
    queryFn: () => getEmployeeLocation(employeeId),
    enabled: Number.isFinite(employeeId),
    retry: false,
  })

  const employee = useMemo(() => {
    return employeesQuery.data?.find((item) => item.id === employeeId)
  }, [employeesQuery.data, employeeId])

  const shiftsQuery = useQuery({
    queryKey: ['department-shifts', employee?.department_id],
    queryFn: () =>
      getDepartmentShifts(
        employee?.department_id ? { department_id: employee.department_id, active_only: false } : undefined,
      ),
    enabled: Boolean(employee?.department_id),
  })

  const locationMutation = useMutation({
    mutationFn: (payload: { home_lat: number; home_lon: number; radius_m: number }) =>
      upsertEmployeeLocation(employeeId, payload),
    onSuccess: () => {
      setFormError(null)
      pushToast({
        variant: 'success',
        title: 'Ev konumu guncellendi',
        description: `Calisan #${employeeId} icin konum kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employee-location', employeeId] })
    },
    onError: (error) => {
      const message = parseApiError(error, 'Konum kaydedilemedi.').message
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Konum kaydedilemedi',
        description: message,
      })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (nextStatus: boolean) => updateEmployeeActive(employeeId, { is_active: nextStatus }),
    onSuccess: (updatedEmployee) => {
      pushToast({
        variant: 'success',
        title: updatedEmployee.is_active ? 'Calisan aktife alindi' : 'Calisan arsive alindi',
        description: `${updatedEmployee.full_name} icin durum guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Durum guncellenemedi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const updateShiftMutation = useMutation({
    mutationFn: (shiftId: number | null) => updateEmployeeShift(employeeId, { shift_id: shiftId }),
    onSuccess: (updatedEmployee) => {
      pushToast({
        variant: 'success',
        title: 'Vardiya atamasi guncellendi',
        description: `${updatedEmployee.full_name} icin vardiya kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Vardiya atamasi basarisiz',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: createDeviceInvite,
    onSuccess: (result) => {
      setInviteError(null)
      setInviteToken(result.token)
      setInviteUrl(result.invite_url)
      pushToast({
        variant: 'success',
        title: 'Cihaz daveti olusturuldu',
        description: `Calisan #${employeeId} icin davet hazir.`,
      })
    },
    onError: (error) => {
      const message = parseApiError(error, 'Cihaz daveti olusturulamadi.').message
      setInviteError(message)
      pushToast({
        variant: 'error',
        title: 'Davet olusturulamadi',
        description: message,
      })
    },
  })

  useEffect(() => {
    if (locationQuery.data) {
      setHomeLat(String(locationQuery.data.home_lat))
      setHomeLon(String(locationQuery.data.home_lon))
      setRadiusM(String(locationQuery.data.radius_m))
    }
  }, [locationQuery.data])

  useEffect(() => {
    if (!employee) return
    setSelectedShiftId(employee.shift_id ? String(employee.shift_id) : '')
  }, [employee?.id, employee?.shift_id, employee])

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      pushToast({
        variant: 'success',
        title: 'Kopyalandi',
        description: 'Deger panoya kopyalandi.',
      })
    } catch {
      pushToast({
        variant: 'error',
        title: 'Kopyalanamadi',
        description: 'Tarayici kopyalama islemini engelledi.',
      })
    }
  }

  const onCreateInvite = () => {
    setInviteError(null)
    setInviteToken(null)
    setInviteUrl(null)
    setExpiresInMinutes('60')
    setInviteModalOpen(true)
  }

  const onInviteSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInviteError(null)

    const parsed = inviteSchema.safeParse({
      expires_in_minutes: expiresInMinutes,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Sure alanini kontrol edin.'
      setInviteError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    inviteMutation.mutate({
      employee_id: employeeId,
      expires_in_minutes: parsed.data.expires_in_minutes,
    })
  }

  if (!Number.isFinite(employeeId)) {
    return <ErrorBlock message="Gecersiz calisan id degeri." />
  }

  if (employeesQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError || !employee) {
    return <ErrorBlock message="Calisan kaydi bulunamadi." />
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = locationSchema.safeParse({
      home_lat: homeLat,
      home_lon: homeLon,
      radius_m: radiusM,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Konum alanlarini kontrol edin.'
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    locationMutation.mutate(parsed.data)
  }

  const hasExistingLocation = Boolean(locationQuery.data)

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Calisan Detayi #${employee.id}`}
        description={`${employee.full_name} icin konum, vardiya, arsiv durumu ve cihaz daveti islemleri`}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const nextStatus = !employee.is_active
                const confirmed = window.confirm(
                  nextStatus
                    ? `${employee.full_name} arsivden cikarilsin mi?`
                    : `${employee.full_name} arsivlensin mi?`,
                )
                if (!confirmed) return
                toggleActiveMutation.mutate(nextStatus)
              }}
              disabled={toggleActiveMutation.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                employee.is_active ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {employee.is_active ? 'Arsivle' : 'Arsivden Cikar (Aktif Et)'}
            </button>
            <button
              type="button"
              onClick={onCreateInvite}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Cihaz Baglama Linki Olustur
            </button>
          </div>
        }
      />

      <Panel>
        <p className="text-sm text-slate-600">Calisan ID: {employee.id}</p>
        <p className="text-sm text-slate-600">Departman ID: {employee.department_id ?? '-'}</p>
        <p className="text-sm text-slate-600">Durum: {employee.is_active ? 'Aktif' : 'Arsivde'}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-sm text-slate-700">
            Vardiya
            <select
              value={selectedShiftId}
              onChange={(event) => setSelectedShiftId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              disabled={!employee.department_id || shiftsQuery.isLoading}
            >
              <option value="">Atanmamis</option>
              {(shiftsQuery.data ?? []).map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shift.start_time_local}-{shift.end_time_local})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={updateShiftMutation.isPending || !employee.department_id}
            onClick={() => {
              const shiftId = selectedShiftId ? Number(selectedShiftId) : null
              updateShiftMutation.mutate(shiftId)
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {updateShiftMutation.isPending ? 'Kaydediliyor...' : 'Vardiya Ata'}
          </button>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Ev Konumu</h4>
        <p className="mt-1 text-xs text-slate-500">
          Check-in konum dogrulamasi icin enlem, boylam ve yaricap metre bilgisini girin.
        </p>
        {locationQuery.isError ? (
          <p className="mt-2 text-sm text-amber-700">Kayitli konum bulunamadi. Ilk kaydi olusturabilirsiniz.</p>
        ) : null}

        <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Ev Enlem (Lat)
            <input
              value={homeLat}
              onChange={(event) => setHomeLat(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ev Boylam (Lon)
            <input
              value={homeLon}
              onChange={(event) => setHomeLon(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Yaricap (metre)
            <input
              value={radiusM}
              onChange={(event) => setRadiusM(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={locationMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {locationMutation.isPending ? (
                <>
                  <span className="inline-spinner" aria-hidden="true" />
                  Kaydediliyor...
                </>
              ) : hasExistingLocation ? (
                'Konumu Guncelle'
              ) : (
                'Konumu Kaydet'
              )}
            </button>
          </div>
        </form>

        {formError ? <p className="form-validation">{formError}</p> : null}
      </Panel>

      <Modal open={isInviteModalOpen} title="Cihaz Baglama Linki Olustur" onClose={() => setInviteModalOpen(false)}>
        <form onSubmit={onInviteSubmit} className="space-y-4">
          <label className="block text-sm text-slate-700">
            Gecerlilik Suresi (dakika)
            <input
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={inviteMutation.isPending}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {inviteMutation.isPending ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Olusturuluyor...
              </>
            ) : (
              'Daveti Uret'
            )}
          </button>
        </form>

        <p className="mt-3 text-xs text-slate-500">
          Bu linki calisana iletin. Calisan linki acinca cihazini otomatik olarak hesabina baglayabilir.
        </p>

        {inviteError ? <p className="form-validation">{inviteError}</p> : null}

        {inviteToken && inviteUrl ? (
          <div className="mt-4 space-y-3">
            <CopyField label="Token" value={inviteToken} onCopy={copyText} />
            <CopyField label="Baglanti Linki (invite_url)" value={inviteUrl} onCopy={copyText} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
