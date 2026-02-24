import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'

import {
  confirmAdminUserMfaSetup,
  createAdminUser,
  deleteAdminUser,
  getAdminUserClaimDetail,
  getAdminUserMfaStatus,
  getAdminUsers,
  regenerateAdminUserMfaRecoveryCodes,
  resetAdminUserMfa,
  updateAdminUserClaimActive,
  startAdminUserMfaSetup,
  updateAdminUser,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type {
  AdminPermissions,
  AdminUser,
  AdminUserClaimDetail,
  AdminUserMfaSetupStartResponse,
} from '../types/api'

type PermissionKey =
  | 'regions'
  | 'departments'
  | 'employees'
  | 'devices'
  | 'work_rules'
  | 'attendance_events'
  | 'leaves'
  | 'reports'
  | 'compliance'
  | 'schedule'
  | 'manual_overrides'
  | 'audit'
  | 'admin_users'

const permissionModules: Array<{ key: PermissionKey; label: string }> = [
  { key: 'regions', label: 'Bolgeler' },
  { key: 'departments', label: 'Departmanlar' },
  { key: 'employees', label: 'Calisanlar' },
  { key: 'devices', label: 'Cihazlar' },
  { key: 'work_rules', label: 'Mesai Kurallari' },
  { key: 'attendance_events', label: 'Yoklama Kayitlari' },
  { key: 'leaves', label: 'Izinler' },
  { key: 'reports', label: 'Raporlar' },
  { key: 'compliance', label: 'Uyumluluk' },
  { key: 'schedule', label: 'Planlama' },
  { key: 'manual_overrides', label: 'Manuel Duzeltme' },
  { key: 'audit', label: 'Denetim Kayitlari' },
  { key: 'admin_users', label: 'Admin Kullanicilari' },
]

function buildEmptyPermissions(): AdminPermissions {
  return Object.fromEntries(
    permissionModules.map((module) => [module.key, { read: false, write: false }]),
  )
}

function normalizePermissions(input?: AdminPermissions | null): AdminPermissions {
  const base = buildEmptyPermissions()
  if (!input) {
    return base
  }

  permissionModules.forEach(({ key }) => {
    const current = input[key]
    if (!current) {
      return
    }
    base[key] = {
      read: Boolean(current.read || current.write),
      write: Boolean(current.write),
    }
  })
  return base
}

function PermissionEditor({
  value,
  disabled = false,
  onChange,
}: {
  value: AdminPermissions
  disabled?: boolean
  onChange: (next: AdminPermissions) => void
}) {
  const updatePermission = (permission: PermissionKey, mode: 'read' | 'write', checked: boolean) => {
    const current = value[permission] ?? { read: false, write: false }
    const nextPermission = { ...current }
    if (mode === 'read') {
      nextPermission.read = checked
      if (!checked) {
        nextPermission.write = false
      }
    } else {
      nextPermission.write = checked
      if (checked) {
        nextPermission.read = true
      }
    }
    onChange({
      ...value,
      [permission]: nextPermission,
    })
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Modul</th>
            <th className="px-3 py-2">Goruntule</th>
            <th className="px-3 py-2">Duzenle</th>
          </tr>
        </thead>
        <tbody>
          {permissionModules.map((module) => {
            const current = value[module.key] ?? { read: false, write: false }
            return (
              <tr key={module.key} className="border-t border-slate-100">
                <td className="px-3 py-2">{module.label}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={current.read}
                    disabled={disabled}
                    onChange={(event) => updatePermission(module.key, 'read', event.target.checked)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={current.write}
                    disabled={disabled}
                    onChange={(event) => updatePermission(module.key, 'write', event.target.checked)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface CreateFormState {
  username: string
  full_name: string
  password: string
  is_active: boolean
  is_super_admin: boolean
  permissions: AdminPermissions
}

function buildCreateFormState(): CreateFormState {
  return {
    username: '',
    full_name: '',
    password: '',
    is_active: true,
    is_super_admin: false,
    permissions: buildEmptyPermissions(),
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString('tr-TR')
}

function truncateUserAgent(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (!text) {
    return '-'
  }
  if (text.length <= 80) {
    return text
  }
  return `${text.slice(0, 80)}...`
}

function maskEndpoint(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '-'
  }
  if (trimmed.length <= 60) {
    return trimmed
  }
  return `${trimmed.slice(0, 30)}...${trimmed.slice(-22)}`
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const { hasPermission, isSuperAdmin, user: authUser } = useAuth()
  const canRead = hasPermission('admin_users')
  const canWrite = hasPermission('admin_users', 'write')

  const [createForm, setCreateForm] = useState<CreateFormState>(buildCreateFormState())
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editFullName, setEditFullName] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editIsSuperAdmin, setEditIsSuperAdmin] = useState(false)
  const [editPermissions, setEditPermissions] = useState<AdminPermissions>(buildEmptyPermissions())
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null)
  const [mfaUser, setMfaUser] = useState<AdminUser | null>(null)
  const [mfaSetupDraft, setMfaSetupDraft] = useState<AdminUserMfaSetupStartResponse | null>(null)
  const [mfaSetupCode, setMfaSetupCode] = useState('')
  const [criticalActionPassword, setCriticalActionPassword] = useState('')
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState<string | null>(null)
  const [latestRecoveryCodes, setLatestRecoveryCodes] = useState<string[]>([])
  const [latestRecoveryExpiresAt, setLatestRecoveryExpiresAt] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
    enabled: canRead,
  })

  const mfaStatusQuery = useQuery({
    queryKey: ['admin-user-mfa-status', mfaUser?.id],
    queryFn: () => getAdminUserMfaStatus(mfaUser!.id),
    enabled: Boolean(mfaUser),
  })
  const detailQuery = useQuery<AdminUserClaimDetail>({
    queryKey: ['admin-user-claim-detail', detailUser?.id],
    queryFn: () => getAdminUserClaimDetail(detailUser!.id),
    enabled: Boolean(detailUser),
  })

  const claimActiveMutation = useMutation({
    mutationFn: ({
      adminUserId,
      claimId,
      nextActive,
    }: {
      adminUserId: number
      claimId: number
      nextActive: boolean
    }) => updateAdminUserClaimActive(adminUserId, claimId, { is_active: nextActive }),
    onSuccess: (_row, variables) => {
      pushToast({
        variant: 'success',
        title: variables.nextActive ? 'Claim aktif edildi' : 'Claim pasife alindi',
        description: variables.nextActive
          ? 'Admin cihazi yeniden aktif edildi.'
          : 'Admin cihazi manuel olarak pasife alindi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['admin-user-claim-detail', variables.adminUserId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Claim durumu guncellenemedi.')
      pushToast({
        variant: 'error',
        title: 'Claim guncelleme hatasi',
        description: parsed.message,
      })
    },
  })

  const createMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Admin kullanici olusturuldu',
        description: 'Yeni admin hesabi kaydedildi.',
      })
      setCreateForm(buildCreateFormState())
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Admin kullanici olusturulamadi.')
      pushToast({
        variant: 'error',
        title: 'Kayit basarisiz',
        description: parsed.message,
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: Parameters<typeof updateAdminUser>[1] }) =>
      updateAdminUser(userId, payload),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Admin kullanici guncellendi',
        description: 'Kullanici yetkileri guncellendi.',
      })
      setEditingUser(null)
      setEditPassword('')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Admin kullanici guncellenemedi.')
      pushToast({
        variant: 'error',
        title: 'Guncelleme basarisiz',
        description: parsed.message,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Admin kullanici silindi',
        description: 'Kullanici kaydi sistemden kaldirildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Admin kullanici silinemedi.')
      pushToast({
        variant: 'error',
        title: 'Silme basarisiz',
        description: parsed.message,
      })
    },
  })

  const startMfaSetupMutation = useMutation({
    mutationFn: (adminUserId: number) => startAdminUserMfaSetup(adminUserId),
    onSuccess: (payload) => {
      setMfaSetupDraft(payload)
      setMfaSetupCode('')
      setLatestRecoveryCodes([])
      setLatestRecoveryExpiresAt(null)
      void mfaStatusQuery.refetch()
      pushToast({
        variant: 'success',
        title: 'MFA kurulumu baslatildi',
        description: 'QR kodu taratip 6 haneli kodu onaylayin.',
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'MFA kurulumu baslatilamadi.')
      pushToast({
        variant: 'error',
        title: 'MFA kurulum hatasi',
        description: parsed.message,
      })
    },
  })

  const confirmMfaSetupMutation = useMutation({
    mutationFn: ({ adminUserId, code }: { adminUserId: number; code: string }) =>
      confirmAdminUserMfaSetup(adminUserId, { code }),
    onSuccess: (payload) => {
      setLatestRecoveryCodes(payload.recovery_codes)
      setLatestRecoveryExpiresAt(payload.recovery_code_expires_at)
      setMfaSetupDraft(null)
      setMfaSetupCode('')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      void mfaStatusQuery.refetch()
      pushToast({
        variant: 'success',
        title: 'MFA aktif edildi',
        description: 'Recovery kodlari olusturuldu.',
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'MFA kodu dogrulanamadi.')
      pushToast({
        variant: 'error',
        title: 'MFA onay hatasi',
        description: parsed.message,
      })
    },
  })

  const regenerateMfaCodesMutation = useMutation({
    mutationFn: ({ adminUserId, currentPassword }: { adminUserId: number; currentPassword: string }) =>
      regenerateAdminUserMfaRecoveryCodes(adminUserId, { current_password: currentPassword }),
    onSuccess: (payload) => {
      setLatestRecoveryCodes(payload.recovery_codes)
      setLatestRecoveryExpiresAt(payload.recovery_code_expires_at)
      setCriticalActionPassword('')
      void mfaStatusQuery.refetch()
      pushToast({
        variant: 'success',
        title: 'Recovery kodlari yenilendi',
        description: 'Eski kodlar pasif edildi.',
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Recovery kodlari yenilenemedi.')
      pushToast({
        variant: 'error',
        title: 'Yenileme hatasi',
        description: parsed.message,
      })
    },
  })

  const resetMfaMutation = useMutation({
    mutationFn: ({ adminUserId, currentPassword }: { adminUserId: number; currentPassword: string }) =>
      resetAdminUserMfa(adminUserId, { current_password: currentPassword }),
    onSuccess: () => {
      setMfaSetupDraft(null)
      setMfaSetupCode('')
      setMfaQrDataUrl(null)
      setLatestRecoveryCodes([])
      setLatestRecoveryExpiresAt(null)
      setCriticalActionPassword('')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      void mfaStatusQuery.refetch()
      pushToast({
        variant: 'success',
        title: 'MFA sifirlandi',
        description: 'Kullanici tekrar MFA kurabilir.',
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'MFA sifirlanamadi.')
      pushToast({
        variant: 'error',
        title: 'Sifirlama hatasi',
        description: parsed.message,
      })
    },
  })

  useEffect(() => {
    if (!mfaSetupDraft?.otpauth_uri) {
      setMfaQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(mfaSetupDraft.otpauth_uri, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (!cancelled) {
          setMfaQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMfaQrDataUrl(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mfaSetupDraft])

  const sortedUsers = useMemo(() => {
    const rows = usersQuery.data ?? []
    return [...rows].sort((left, right) => left.username.localeCompare(right.username))
  }, [usersQuery.data])
  const mfaStatus = mfaStatusQuery.data

  if (!canRead) {
    return <ErrorBlock message="Bu alani goruntuleme yetkiniz yok." />
  }

  if (usersQuery.isLoading) {
    return <LoadingBlock label="Admin kullanicilar yukleniyor..." />
  }

  if (usersQuery.isError) {
    return <ErrorBlock message="Admin kullanici listesi alinamadi." />
  }

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canWrite) {
      return
    }
    if (!isSuperAdmin) {
      pushToast({
        variant: 'info',
        title: 'Yetki siniri',
        description: 'Sadece super admin yeni admin kullanici olusturabilir.',
      })
      return
    }
    if (createForm.password.length < 8) {
      pushToast({
        variant: 'error',
        title: 'Kayit basarisiz',
        description: 'Sifre alani en az 8 karakter olmali.',
      })
      return
    }
    createMutation.mutate({
      username: createForm.username.trim(),
      full_name: createForm.full_name.trim() || null,
      password: createForm.password,
      is_active: createForm.is_active,
      is_super_admin: createForm.is_super_admin,
      permissions: createForm.is_super_admin ? buildEmptyPermissions() : createForm.permissions,
    })
  }

  const openEditModal = (user: AdminUser) => {
    setEditingUser(user)
    setEditUsername(user.username)
    setEditFullName(user.full_name ?? '')
    setEditPassword('')
    setEditIsActive(user.is_active)
    setEditIsSuperAdmin(user.is_super_admin)
    setEditPermissions(normalizePermissions(user.permissions))
  }

  const openDetailModal = (user: AdminUser) => {
    setDetailUser(user)
  }

  const closeDetailModal = () => {
    setDetailUser(null)
  }

  const openMfaModal = (user: AdminUser) => {
    setMfaUser(user)
    setMfaSetupDraft(null)
    setMfaSetupCode('')
    setCriticalActionPassword('')
    setMfaQrDataUrl(null)
    setLatestRecoveryCodes([])
    setLatestRecoveryExpiresAt(null)
  }

  const closeMfaModal = () => {
    setMfaUser(null)
    setMfaSetupDraft(null)
    setMfaSetupCode('')
    setCriticalActionPassword('')
    setMfaQrDataUrl(null)
    setLatestRecoveryCodes([])
    setLatestRecoveryExpiresAt(null)
  }

  const submitUpdate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingUser || !canWrite) {
      return
    }
    if (editPassword.trim() && editPassword.trim().length < 8) {
      pushToast({
        variant: 'error',
        title: 'Guncelleme basarisiz',
        description: 'Yeni sifre en az 8 karakter olmali.',
      })
      return
    }
    updateMutation.mutate({
        userId: editingUser.id,
        payload: {
          username: editUsername.trim(),
          full_name: editFullName.trim() || null,
          password: editPassword.trim() ? editPassword : undefined,
        is_active: editIsActive,
        is_super_admin: editIsSuperAdmin,
        permissions: editIsSuperAdmin ? buildEmptyPermissions() : editPermissions,
      },
    })
  }

  const submitConfirmMfa = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mfaUser || !mfaSetupCode.trim()) {
      return
    }
    confirmMfaSetupMutation.mutate({
      adminUserId: mfaUser.id,
      code: mfaSetupCode.trim(),
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin Kullanici ve Yetki Yonetimi"
        description="Belirli modullere erisebilen read-only veya tam yetkili admin hesaplari olusturun."
      />

      <Panel>
        <h4 className="mb-3 text-base font-semibold text-slate-900">Yeni Admin Kullanici</h4>
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Sistem super admin hesabi: <strong>admin</strong> (env). Bu hesap her zaman tam yetkilidir.
        </p>
        {!isSuperAdmin ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Sadece super admin hesaplari yeni admin olusturabilir ve yetki duzenleyebilir.
          </p>
        ) : null}
        <form onSubmit={submitCreate} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Kullanici Adi
              <input
                value={createForm.username}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                disabled={!canWrite || !isSuperAdmin}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="ik_readonly"
              />
            </label>
            <label className="text-sm text-slate-700">
              Ad Soyad
              <input
                value={createForm.full_name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, full_name: event.target.value }))}
                disabled={!canWrite || !isSuperAdmin}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="IK Operasyon"
              />
            </label>
            <label className="text-sm text-slate-700 md:col-span-2">
              Sifre
              <input
                type="password"
                value={createForm.password}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                disabled={!canWrite || !isSuperAdmin}
                minLength={8}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="En az 8 karakter"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={createForm.is_active}
                disabled={!canWrite || !isSuperAdmin}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, is_active: event.target.checked }))}
              />
              Aktif
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={createForm.is_super_admin}
                disabled={!canWrite || !isSuperAdmin}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, is_super_admin: event.target.checked }))}
              />
              Super Admin
            </label>
          </div>

          {!createForm.is_super_admin ? (
            <PermissionEditor
              value={createForm.permissions}
              disabled={!canWrite || !isSuperAdmin}
              onChange={(next) => setCreateForm((prev) => ({ ...prev, permissions: next }))}
            />
          ) : (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Super admin secili oldugu icin tum modullerde tam yetki verilecektir.
            </p>
          )}

          <button
            type="submit"
            disabled={!canWrite || !isSuperAdmin || createMutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createMutation.isPending ? 'Kaydediliyor...' : 'Kullanici Olustur'}
          </button>
        </form>
      </Panel>

      <Panel>
        <h4 className="mb-3 text-base font-semibold text-slate-900">Mevcut Admin Kullanicilar</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">ID</th>
                <th className="py-2">Kullanici</th>
                <th className="py-2">Ad Soyad</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Rol</th>
                <th className="py-2">Bagli Cihaz</th>
                <th className="py-2">MFA</th>
                <th className="py-2">Islem</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="py-2">{user.id}</td>
                  <td className="py-2 font-medium text-slate-900">{user.username}</td>
                  <td className="py-2">{user.full_name ?? '-'}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        user.is_active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {user.is_active ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td className="py-2">{user.is_super_admin ? 'Super Admin' : 'Yetkili Admin'}</td>
                  <td className="py-2">
                    <div className="text-xs text-slate-700">
                      <span className="font-semibold text-emerald-700">{user.claim_active_total ?? 0}</span> aktif /{' '}
                      <span className="font-semibold">{user.claim_total ?? 0}</span> toplam
                    </div>
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        user.mfa_enabled
                          ? 'bg-emerald-100 text-emerald-800'
                          : user.mfa_secret_configured
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {user.mfa_enabled ? 'Aktif' : user.mfa_secret_configured ? 'Kurulum Bekliyor' : 'Kapali'}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openDetailModal(user)}
                        className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Detay
                      </button>
                      <button
                        type="button"
                        disabled={!(isSuperAdmin || (authUser?.admin_user_id ?? 0) === user.id)}
                        onClick={() => openMfaModal(user)}
                        className="rounded-lg border border-brand-200 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                      >
                        MFA
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || !isSuperAdmin}
                        onClick={() => openEditModal(user)}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Duzenle
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || !isSuperAdmin || deleteMutation.isPending}
                        onClick={() => {
                          const confirmed = window.confirm(
                            `${user.username} kullanicisini silmek istediginize emin misiniz?`,
                          )
                          if (!confirmed) {
                            return
                          }
                          deleteMutation.mutate(user.id)
                        }}
                        className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sortedUsers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Kayitli admin kullanici bulunamadi.</p>
        ) : null}
      </Panel>

      <Modal
        open={Boolean(detailUser)}
        title={detailUser ? `Admin Detay: ${detailUser.username}` : 'Admin Detay'}
        onClose={closeDetailModal}
      >
        {detailUser ? (
          <div className="space-y-4">
            {detailQuery.isLoading ? (
              <p className="text-sm text-slate-500">Detay yukleniyor...</p>
            ) : null}
            {detailQuery.isError ? (
              <ErrorBlock message="Admin claim detayi alinamadi." />
            ) : null}
            {detailQuery.data ? (
              <>
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    Toplam claim: <strong>{detailQuery.data.claim_total}</strong>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Aktif claim: <strong>{detailQuery.data.claim_active_total}</strong>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    Pasif claim: <strong>{detailQuery.data.claim_inactive_total}</strong>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    Benzersiz cihaz: <strong>{new Set(detailQuery.data.claims.map((item) => item.endpoint_fingerprint)).size}</strong>
                  </div>
                </div>

                <section>
                  <h5 className="text-sm font-semibold text-slate-900">Bagli Cihaz / Claim Listesi</h5>
                  <div className="mt-2 max-h-60 overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 uppercase text-slate-500">
                        <tr>
                          <th className="px-2 py-2">ID</th>
                          <th className="px-2 py-2">Durum</th>
                          <th className="px-2 py-2">Fingerprint</th>
                          <th className="px-2 py-2">Son Gorulme</th>
                          <th className="px-2 py-2">Hata</th>
                          <th className="px-2 py-2">Tarayici</th>
                          <th className="px-2 py-2">Endpoint</th>
                          <th className="px-2 py-2">Islem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailQuery.data.claims.map((claim) => (
                          <tr key={claim.id} className="border-t border-slate-100">
                            <td className="px-2 py-2">{claim.id}</td>
                            <td className="px-2 py-2">
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                  claim.is_active
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {claim.is_active ? 'Aktif' : 'Pasif'}
                              </span>
                            </td>
                            <td className="px-2 py-2 font-mono text-[11px]">{claim.endpoint_fingerprint}</td>
                            <td className="px-2 py-2">{formatDateTime(claim.last_seen_at)}</td>
                            <td className="px-2 py-2">{claim.last_error?.trim() ? claim.last_error : '-'}</td>
                            <td className="px-2 py-2" title={claim.user_agent ?? '-'}>
                              {truncateUserAgent(claim.user_agent)}
                            </td>
                            <td className="px-2 py-2 font-mono text-[11px]" title={claim.endpoint}>
                              {maskEndpoint(claim.endpoint)}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                disabled={!canWrite || !isSuperAdmin || claimActiveMutation.isPending || !detailUser}
                                onClick={() => {
                                  if (!detailUser) {
                                    return
                                  }
                                  if (!claim.is_active) {
                                    claimActiveMutation.mutate({
                                      adminUserId: detailUser.id,
                                      claimId: claim.id,
                                      nextActive: true,
                                    })
                                    return
                                  }
                                  const confirmed = window.confirm('Bu admin claim pasife alinsin mi?')
                                  if (!confirmed) {
                                    return
                                  }
                                  claimActiveMutation.mutate({
                                    adminUserId: detailUser.id,
                                    claimId: claim.id,
                                    nextActive: false,
                                  })
                                }}
                                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                                  claim.is_active
                                    ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                                    : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                                }`}
                              >
                                {claim.is_active ? 'Pasife Al' : 'Aktif Et'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detailQuery.data.claims.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-slate-500">Bu kullanici icin claim kaydi yok.</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h5 className="text-sm font-semibold text-slate-900">Olusturulan Claim Davetleri</h5>
                  <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 uppercase text-slate-500">
                        <tr>
                          <th className="px-2 py-2">ID</th>
                          <th className="px-2 py-2">Durum</th>
                          <th className="px-2 py-2">Deneme</th>
                          <th className="px-2 py-2">Bitis</th>
                          <th className="px-2 py-2">Kullanan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailQuery.data.created_invites.map((invite) => (
                          <tr key={invite.id} className="border-t border-slate-100">
                            <td className="px-2 py-2">{invite.id}</td>
                            <td className="px-2 py-2">{invite.status}</td>
                            <td className="px-2 py-2">
                              {invite.attempt_count}/{invite.max_attempts}
                            </td>
                            <td className="px-2 py-2">{formatDateTime(invite.expires_at)}</td>
                            <td className="px-2 py-2">{invite.used_by_username ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detailQuery.data.created_invites.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-slate-500">Kayit yok.</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h5 className="text-sm font-semibold text-slate-900">Kullandigi Claim Davetleri</h5>
                  <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 uppercase text-slate-500">
                        <tr>
                          <th className="px-2 py-2">ID</th>
                          <th className="px-2 py-2">Durum</th>
                          <th className="px-2 py-2">Olusturan</th>
                          <th className="px-2 py-2">Kullanilan Zaman</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailQuery.data.used_invites.map((invite) => (
                          <tr key={invite.id} className="border-t border-slate-100">
                            <td className="px-2 py-2">{invite.id}</td>
                            <td className="px-2 py-2">{invite.status}</td>
                            <td className="px-2 py-2">{invite.created_by_username}</td>
                            <td className="px-2 py-2">{formatDateTime(invite.used_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detailQuery.data.used_invites.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-slate-500">Kayit yok.</p>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editingUser)}
        title="Admin Kullanici Duzenle"
        onClose={() => {
          setEditingUser(null)
          setEditPassword('')
        }}
      >
        {editingUser ? (
          <form onSubmit={submitUpdate} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Kullanici Adi
                <input
                  value={editUsername}
                  onChange={(event) => setEditUsername(event.target.value)}
                  disabled={!canWrite || !isSuperAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Ad Soyad
                <input
                  value={editFullName}
                  onChange={(event) => setEditFullName(event.target.value)}
                  disabled={!canWrite || !isSuperAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700 md:col-span-2">
                Yeni Sifre (bos birakilirsa degismez)
                <input
                  type="password"
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  disabled={!canWrite || !isSuperAdmin}
                  minLength={8}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Opsiyonel"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  disabled={!canWrite || !isSuperAdmin}
                  onChange={(event) => setEditIsActive(event.target.checked)}
                />
                Aktif
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editIsSuperAdmin}
                  disabled={!canWrite || !isSuperAdmin}
                  onChange={(event) => setEditIsSuperAdmin(event.target.checked)}
                />
                Super Admin
              </label>
            </div>

            {!editIsSuperAdmin ? (
              <PermissionEditor
                value={editPermissions}
                disabled={!canWrite || !isSuperAdmin}
                onChange={setEditPermissions}
              />
            ) : (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Super admin secili oldugu icin tum modullerde tam yetki verilecektir.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingUser(null)
                  setEditPassword('')
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={!canWrite || !isSuperAdmin || updateMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'Kaydediliyor...' : 'Guncelle'}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(mfaUser)}
        title={mfaUser ? `MFA Yonetimi: ${mfaUser.username}` : 'MFA Yonetimi'}
        onClose={closeMfaModal}
      >
        {mfaUser ? (
          <div className="space-y-4">
            {mfaStatusQuery.isLoading ? (
              <p className="text-sm text-slate-500">MFA durumu yukleniyor...</p>
            ) : null}
            {mfaStatus ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p>
                  Durum:{' '}
                  <strong>{mfaStatus.mfa_enabled ? 'MFA aktif' : mfaStatus.has_secret ? 'Kurulum bekliyor' : 'Kapali'}</strong>
                </p>
                <p>Aktif recovery kodu: {mfaStatus.recovery_code_active_count}</p>
                <p>
                  Son guncelleme:{' '}
                  {mfaStatus.updated_at ? new Date(mfaStatus.updated_at).toLocaleString('tr-TR') : '-'}
                </p>
                <p>
                  Kod son gecerlilik:{' '}
                  {mfaStatus.recovery_code_expires_at
                    ? new Date(mfaStatus.recovery_code_expires_at).toLocaleDateString('tr-TR')
                    : '-'}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={startMfaSetupMutation.isPending}
                onClick={() => startMfaSetupMutation.mutate(mfaUser.id)}
                className="rounded-lg border border-brand-300 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"
              >
                {startMfaSetupMutation.isPending ? 'Baslatiliyor...' : 'Kurulumu Baslat / Yenile'}
              </button>
            </div>

            {mfaSetupDraft ? (
              <form onSubmit={submitConfirmMfa} className="space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 px-3 py-3">
                <p className="text-sm font-medium text-brand-900">1) Authenticator ile QR kodu tarat</p>
                {mfaQrDataUrl ? (
                  <img src={mfaQrDataUrl} alt="MFA QR" className="h-44 w-44 rounded-lg border border-brand-200 bg-white p-2" />
                ) : (
                  <p className="text-xs text-slate-600">QR olusturulamadi. Asagidaki anahtari manuel girin.</p>
                )}
                <p className="text-xs text-slate-700">Secret: <code>{mfaSetupDraft.secret_key}</code></p>
                <p className="text-xs text-slate-600 break-all">{mfaSetupDraft.otpauth_uri}</p>
                <label className="block text-sm text-slate-700">
                  2) Uretilen 6 haneli kod
                  <input
                    value={mfaSetupCode}
                    onChange={(event) => setMfaSetupCode(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="123456"
                  />
                </label>
                <button
                  type="submit"
                  disabled={confirmMfaSetupMutation.isPending || !mfaSetupCode.trim()}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {confirmMfaSetupMutation.isPending ? 'Onaylaniyor...' : 'MFA Kurulumunu Onayla'}
                </button>
              </form>
            ) : null}

            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3">
              <p className="text-sm font-medium text-slate-800">Kritik Islemler (Sizin sifreniz gerekli)</p>
              <label className="block text-sm text-slate-700">
                Mevcut sifreniz
                <input
                  type="password"
                  value={criticalActionPassword}
                  onChange={(event) => setCriticalActionPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Sizin admin sifreniz"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    regenerateMfaCodesMutation.isPending ||
                    !criticalActionPassword.trim() ||
                    !mfaStatus?.mfa_enabled
                  }
                  onClick={() => {
                    if (!criticalActionPassword.trim()) {
                      return
                    }
                    regenerateMfaCodesMutation.mutate({
                      adminUserId: mfaUser.id,
                      currentPassword: criticalActionPassword,
                    })
                  }}
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                >
                  {regenerateMfaCodesMutation.isPending ? 'Yenileniyor...' : 'Recovery Kodlarini Yenile'}
                </button>
                <button
                  type="button"
                  disabled={resetMfaMutation.isPending || !criticalActionPassword.trim()}
                  onClick={() => {
                    const confirmed = window.confirm(`${mfaUser.username} icin MFA sifirlansin mi?`)
                    if (!confirmed || !criticalActionPassword.trim()) {
                      return
                    }
                    resetMfaMutation.mutate({
                      adminUserId: mfaUser.id,
                      currentPassword: criticalActionPassword,
                    })
                  }}
                  className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  {resetMfaMutation.isPending ? 'Sifirlaniyor...' : 'MFA Sifirla'}
                </button>
              </div>
            </div>

            {latestRecoveryCodes.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <p className="font-semibold">Recovery kodlari (tek seferlik gosterim)</p>
                <p className="mt-1 text-xs">
                  Gecerlilik:{' '}
                  {latestRecoveryExpiresAt ? new Date(latestRecoveryExpiresAt).toLocaleDateString('tr-TR') : '-'}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {latestRecoveryCodes.map((code) => (
                    <code key={code} className="rounded bg-white px-2 py-1 text-slate-900">
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
