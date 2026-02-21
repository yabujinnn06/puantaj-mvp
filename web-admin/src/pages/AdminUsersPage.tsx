import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createAdminUser, deleteAdminUser, getAdminUsers, updateAdminUser } from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type { AdminPermissions, AdminUser } from '../types/api'

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

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const { hasPermission, isSuperAdmin } = useAuth()
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

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
    enabled: canRead,
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

  const sortedUsers = useMemo(() => {
    const rows = usersQuery.data ?? []
    return [...rows].sort((left, right) => left.username.localeCompare(right.username))
  }, [usersQuery.data])

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
                    <div className="flex flex-wrap gap-2">
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
    </div>
  )
}
