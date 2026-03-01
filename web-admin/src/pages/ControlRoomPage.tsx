import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getControlRoomOverview,
  getDepartments,
  getEmployees,
  getRegions,
  type ControlRoomOverviewParams,
} from "../api/admin";
import {
  ControlRoomMap,
  type ControlRoomMapMarker,
} from "../components/ControlRoomMap";
import { ErrorBlock } from "../components/ErrorBlock";
import { LoadingBlock } from "../components/LoadingBlock";
import { MinuteDisplay } from "../components/MinuteDisplay";
import { PageHeader } from "../components/PageHeader";
import type {
  ControlRoomEmployeeState,
  ControlRoomLocationState,
  Employee,
  LocationStatus,
} from "../types/api";

const DEFAULT_LIMIT = 35;
const PAGE_LIMITS = [12, 24, 35, 50];
const ISTANBUL_TIMEZONE = "Europe/Istanbul";

const dt = (value: string | null | undefined) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

const rel = (value: string | null | undefined) => {
  if (!value) return "Akış yok";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return "-";
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "Şimdi";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
};

const todayLabel = (value: "NOT_STARTED" | "IN_PROGRESS" | "FINISHED") =>
  value === "IN_PROGRESS"
    ? "Sahada"
    : value === "FINISHED"
      ? "Tamamlandı"
      : "Başlamadı";
const locLabel = (value: ControlRoomLocationState) =>
  value === "LIVE"
    ? "Canlı"
    : value === "STALE"
      ? "Sıcak"
      : value === "DORMANT"
        ? "Soğuk"
        : "Veri yok";
const eventLabel = (value: "IN" | "OUT") =>
  value === "IN" ? "Giriş" : "Çıkış";
const locationStatusLabel = (value: LocationStatus) =>
  value === "VERIFIED_HOME"
    ? "Doğrulandı"
    : value === "UNVERIFIED_LOCATION"
      ? "Doğrulanamadı"
      : "Konum yok";
const alertText = (value: "info" | "warning" | "critical") =>
  value === "critical" ? "Kritik" : value === "warning" ? "Uyarı" : "Bilgi";
const statusClass = (value: "NOT_STARTED" | "IN_PROGRESS" | "FINISHED") =>
  value === "IN_PROGRESS"
    ? "control-room-pill status-live"
    : value === "FINISHED"
      ? "control-room-pill status-finished"
      : "control-room-pill status-idle";
const locClass = (value: ControlRoomLocationState) =>
  value === "LIVE"
    ? "control-room-pill location-live"
    : value === "STALE"
      ? "control-room-pill location-stale"
      : value === "DORMANT"
        ? "control-room-pill location-dormant"
        : "control-room-pill location-none";
const alertClass = (value: "info" | "warning" | "critical") =>
  value === "critical"
    ? "control-room-alert control-room-alert-critical"
    : value === "warning"
      ? "control-room-alert control-room-alert-warning"
      : "control-room-alert control-room-alert-info";
const dateValue = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
const TODAY_DATE = dateValue(new Date());
const YESTERDAY_DATE = (() => {
  const value = new Date();
  value.setDate(value.getDate() - 1);
  return dateValue(value);
})();
const threatScore = (item: ControlRoomEmployeeState | null) =>
  !item
    ? 0
    : item.attention_flags.reduce(
        (total, flag) =>
          total +
          (flag.severity === "critical"
            ? 45
            : flag.severity === "warning"
              ? 20
              : 8),
        item.today_status === "IN_PROGRESS" ? 16 : 6,
      );
const threatLevel = (value: number) =>
  value >= 70 ? "Kırmızı seviye" : value >= 35 ? "Sarı seviye" : "Stabil";
const employeeMatchScore = (employee: Employee, query: string) => {
  const normalized = query.trim().toLocaleLowerCase("tr-TR").replace("#", "");
  if (!normalized) return 1;
  const name = employee.full_name.toLocaleLowerCase("tr-TR");
  const idText = String(employee.id);
  if (name.startsWith(normalized) || idText.startsWith(normalized)) return 5;
  if (name.includes(normalized) || idText.includes(normalized)) return 3;
  return 0;
};

function CommandField({
  label,
  employees,
  value,
  onChange,
  placeholder,
  helperText,
}: {
  label: string;
  employees: Employee[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helperText?: string;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(
    () =>
      employees
        .map((employee) => ({
          employee,
          score: employeeMatchScore(employee, value),
        }))
        .filter((item) => item.score > 0 || !value.trim())
        .sort(
          (left, right) =>
            right.score - left.score ||
            Number(right.employee.is_active) -
              Number(left.employee.is_active) ||
            left.employee.full_name.localeCompare(
              right.employee.full_name,
              "tr-TR",
            ),
        )
        .slice(0, value.trim() ? 10 : 8),
    [employees, value],
  );

  return (
    <label className="control-room-field control-room-command-field">
      <span>{label}</span>
      <div className="control-room-command-shell">
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        <button
          type="button"
          className="control-room-inline-clear"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
        >
          Temizle
        </button>
        {open ? (
          <div className="control-room-command-menu">
            {suggestions.length ? (
              suggestions.map(({ employee }) => (
                <button
                  key={employee.id}
                  type="button"
                  className="control-room-command-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(employee.full_name);
                    setOpen(false);
                  }}
                >
                  <span>
                    #{employee.id} - {employee.full_name}
                  </span>
                  <small>{employee.is_active ? "Aktif" : "Pasif"}</small>
                </button>
              ))
            ) : (
              <div className="control-room-command-empty">
                Eşleşen çalışan yok.
              </div>
            )}
          </div>
        ) : null}
      </div>
      {helperText ? (
        <small className="control-room-field-help">{helperText}</small>
      ) : null}
    </label>
  );
}

export function ControlRoomPage() {
  const [roomUnlocked, setRoomUnlocked] = useState(false);
  const [booting, setBooting] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [regionId, setRegionId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [todayStatus, setTodayStatus] = useState<
    "NOT_STARTED" | "IN_PROGRESS" | "FINISHED" | ""
  >("");
  const [locationState, setLocationState] = useState<
    ControlRoomLocationState | ""
  >("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [mapDate, setMapDate] = useState(TODAY_DATE);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [page, setPage] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [feedQuery, setFeedQuery] = useState("");
  const [feedType, setFeedType] = useState<"" | "IN" | "OUT">("");
  const [feedLocationStatus, setFeedLocationStatus] = useState<
    LocationStatus | ""
  >("");
  const [feedOnlySelected, setFeedOnlySelected] = useState(false);

  const regionsQuery = useQuery({
    queryKey: ["regions", "control-room"],
    queryFn: () => getRegions({ include_inactive: false }),
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments", "control-room"],
    queryFn: getDepartments,
  });
  const employeesQuery = useQuery({
    queryKey: ["employees", "control-room"],
    queryFn: () => getEmployees({ include_inactive: true, status: "all" }),
  });
  const availableDepartments = useMemo(() => {
    const all = departmentsQuery.data ?? [];
    return regionId ? all.filter((item) => item.region_id === regionId) : all;
  }, [departmentsQuery.data, regionId]);

  useEffect(() => {
    if (
      departmentId &&
      !availableDepartments.some((item) => item.id === departmentId)
    )
      setDepartmentId(null);
  }, [availableDepartments, departmentId]);

  useEffect(() => {
    if (!booting) return;
    const timer = window.setTimeout(() => {
      setBooting(false);
      setRoomUnlocked(true);
    }, 1250);
    return () => window.clearTimeout(timer);
  }, [booting]);

  useEffect(() => {
    if (!detailOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailOpen]);

  useEffect(() => {
    setPage(1);
  }, [
    queryText,
    regionId,
    departmentId,
    todayStatus,
    locationState,
    includeInactive,
    limit,
  ]);

  const params = useMemo<ControlRoomOverviewParams>(
    () => ({
      q: queryText.trim() || undefined,
      region_id: regionId ?? undefined,
      department_id: departmentId ?? undefined,
      today_status: todayStatus || undefined,
      location_state: locationState || undefined,
      map_date: mapDate || undefined,
      include_inactive: includeInactive || undefined,
      offset: (page - 1) * limit,
      limit,
    }),
    [
      queryText,
      regionId,
      departmentId,
      todayStatus,
      locationState,
      mapDate,
      includeInactive,
      page,
      limit,
    ],
  );
  const overviewQuery = useQuery({
    queryKey: ["control-room-overview", params],
    queryFn: () => getControlRoomOverview(params),
    enabled: roomUnlocked,
    refetchInterval: roomUnlocked ? 20_000 : false,
    placeholderData: (prev) => prev,
  });

  const items = overviewQuery.data?.items ?? [];
  const employees = employeesQuery.data ?? [];
  const total = overviewQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(page * limit, total);

  useEffect(() => {
    if (!items.length) return void setSelectedEmployeeId(null);
    if (
      !selectedEmployeeId ||
      !items.some((item) => item.employee.id === selectedEmployeeId)
    )
      setSelectedEmployeeId(items[0].employee.id);
  }, [items, selectedEmployeeId]);

  const selectedEmployee = useMemo(
    () =>
      items.find((item) => item.employee.id === selectedEmployeeId) ??
      items[0] ??
      null,
    [items, selectedEmployeeId],
  );
  const selectedThreatScore = useMemo(
    () => threatScore(selectedEmployee),
    [selectedEmployee],
  );
  const mapMarkers = useMemo<ControlRoomMapMarker[]>(
    () =>
      (overviewQuery.data?.map_points ?? []).map((point) => ({
        id: `employee-${point.employee_id}`,
        lat: point.lat,
        lon: point.lon,
        label: point.label,
        todayStatus: point.today_status,
        locationState: point.location_state,
      })),
    [overviewQuery.data?.map_points],
  );
  const feedRows = useMemo(
    () =>
      (overviewQuery.data?.recent_events ?? []).filter(
        (event) =>
          (!feedType || event.event_type === feedType) &&
          (!feedLocationStatus ||
            event.location_status === feedLocationStatus) &&
          (!feedOnlySelected ||
            event.employee_id === selectedEmployee?.employee.id) &&
          (!feedQuery.trim() ||
            event.employee_name
              .toLocaleLowerCase("tr-TR")
              .includes(feedQuery.trim().toLocaleLowerCase("tr-TR")) ||
            String(event.employee_id).includes(feedQuery.replace("#", ""))),
      ),
    [
      overviewQuery.data?.recent_events,
      feedType,
      feedLocationStatus,
      feedOnlySelected,
      feedQuery,
      selectedEmployee,
    ],
  );

  if (
    regionsQuery.isError ||
    departmentsQuery.isError ||
    employeesQuery.isError
  )
    return <ErrorBlock message="Kontrol odası filtre verileri alınamadı." />;

  return (
    <div className="control-room-page">
      <PageHeader
        title="Kontrol Odası"
        description="Mevcut admin oturumu içinde, vardiya matrisi, konum izi ve operasyon alarm akışını tek ekranda yönetin."
        action={
          roomUnlocked ? (
            <button
              type="button"
              className="btn-animated control-room-refresh-button"
              onClick={() => void overviewQuery.refetch()}
            >
              Matrisi yenile
            </button>
          ) : null
        }
      />

      {!roomUnlocked && !booting ? (
        <section className="control-room-intro">
          <div className="control-room-intro-copy">
            <p className="control-room-kicker">
              BLACKLIST CORE / LIVE SURVEILLANCE GRID
            </p>
            <h2 className="control-room-intro-title">
              Operasyon ekranı. Aynı sistemin içindeki sert katman.
            </h2>
            <p className="control-room-intro-text">
              Ayrı uygulama değil. Aynı admin paneli içinde; saha durumu, cihaz
              izi, IP, alarm yoğunluğu ve personel hareketlerini bir dosya
              masası gibi önüne açar.
            </p>
            <div className="control-room-intro-tags">
              <span className="control-room-inline-tag">
                Harita geri sarımı
              </span>
              <span className="control-room-inline-tag">Vardiya matrisi</span>
              <span className="control-room-inline-tag">
                Target lock dosyası
              </span>
            </div>
          </div>
          <div className="control-room-intro-side">
            <div className="control-room-intro-console">
              <div className="control-room-console-line">
                <span>AUTH</span>
                <strong>SESSION VERIFIED</strong>
              </div>
              <div className="control-room-console-line">
                <span>MODE</span>
                <strong>ADMIN LINKED</strong>
              </div>
              <div className="control-room-console-line">
                <span>GRID</span>
                <strong>BLACKLIST READY</strong>
              </div>
            </div>
            <button
              type="button"
              className="control-room-launch-button"
              onClick={() => setBooting(true)}
            >
              Kontrol odasını aç
            </button>
          </div>
        </section>
      ) : null}

      {booting ? (
        <div
          className="control-room-boot-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="control-room-boot-core">
            <div className="control-room-boot-ring" />
            <div className="control-room-boot-orbit" />
            <div className="control-room-boot-panel">
              <p className="control-room-boot-kicker">CONTROL CORE</p>
              <p className="control-room-boot-title">
                Blacklist matrisi hazırlanıyor...
              </p>
              <p className="control-room-boot-subtitle">
                vardiya / konum / cihaz / ip / alarm akışı eşleniyor
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {roomUnlocked ? (
        <div className="control-room-shell">
          <section className="control-room-topline">
            <div>
              <p className="control-room-kicker">REAL-TIME FIELD COMMAND</p>
              <h2 className="control-room-heading">Canlı operasyon matrisi</h2>
            </div>
            <div className="control-room-topline-meta">
              <span className="control-room-inline-tag">
                Son üretim: {dt(overviewQuery.data?.generated_at_utc ?? null)}
              </span>
              <span className="control-room-inline-tag">
                Matris sayfası {page}/{totalPages}
              </span>
              <span className="control-room-inline-tag">
                Harita günü {mapDate || "-"}
              </span>
            </div>
          </section>

          <section className="control-room-kpi-grid">
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Filtreli personel</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.total_employees ?? 0}
              </strong>
              <span className="control-room-kpi-meta">
                Aktif: {overviewQuery.data?.summary.active_employees ?? 0}
              </span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Sahadakiler</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.in_progress_count ?? 0}
              </strong>
              <span className="control-room-kpi-meta">Açık vardiya</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Başlamayan</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.not_started_count ?? 0}
              </strong>
              <span className="control-room-kpi-meta">Bugün giriş yok</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Tamamlayan</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.finished_count ?? 0}
              </strong>
              <span className="control-room-kpi-meta">Günü kapatan</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Sayfa alarmı</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.attention_on_page_count ?? 0}
              </strong>
              <span className="control-room-kpi-meta">
                Manuel bakış isteyen
              </span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Canlı konum</span>
              <strong className="control-room-kpi-value">
                {overviewQuery.data?.summary.live_location_on_page_count ?? 0}
              </strong>
              <span className="control-room-kpi-meta">
                Haritada sıcak nokta
              </span>
            </article>
          </section>
          <div className="control-room-main-grid">
            <section className="control-room-panel control-room-filter-panel">
              <div className="control-room-panel-head">
                <div>
                  <p className="control-room-panel-kicker">FILTER STACK</p>
                  <h3>Operasyon süzgeci</h3>
                </div>
                <span className="control-room-inline-tag">
                  Yazarken öneri verir
                </span>
              </div>
              <div className="control-room-filter-grid">
                <CommandField
                  label="Çalışan / #ID"
                  employees={employees}
                  value={queryText}
                  onChange={setQueryText}
                  placeholder="Örn. Hüseyincan, #1 veya sadece h"
                  helperText="İsmin başını yazmanız yeterli; eşleşen çalışanlar hemen gelir."
                />
                <label className="control-room-field">
                  <span>Bölge</span>
                  <select
                    value={regionId ?? ""}
                    onChange={(event) =>
                      setRegionId(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  >
                    <option value="">Tümü</option>
                    {(regionsQuery.data ?? []).map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Departman</span>
                  <select
                    value={departmentId ?? ""}
                    onChange={(event) =>
                      setDepartmentId(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  >
                    <option value="">Tümü</option>
                    {availableDepartments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Gün durumu</span>
                  <select
                    value={todayStatus}
                    onChange={(event) =>
                      setTodayStatus(event.target.value as typeof todayStatus)
                    }
                  >
                    <option value="">Tümü</option>
                    <option value="NOT_STARTED">Başlamadı</option>
                    <option value="IN_PROGRESS">Sahada</option>
                    <option value="FINISHED">Tamamlandı</option>
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Konum ısısı</span>
                  <select
                    value={locationState}
                    onChange={(event) =>
                      setLocationState(
                        event.target.value as typeof locationState,
                      )
                    }
                  >
                    <option value="">Tümü</option>
                    <option value="LIVE">Canlı</option>
                    <option value="STALE">Sıcak</option>
                    <option value="DORMANT">Soğuk</option>
                    <option value="NONE">Veri yok</option>
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Harita günü</span>
                  <input
                    type="date"
                    value={mapDate}
                    onChange={(event) => setMapDate(event.target.value)}
                  />
                </label>
                <label className="control-room-field">
                  <span>Matris limiti</span>
                  <select
                    value={limit}
                    onChange={(event) => setLimit(Number(event.target.value))}
                  >
                    {PAGE_LIMITS.map((pageLimit) => (
                      <option key={pageLimit} value={pageLimit}>
                        {pageLimit}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="control-room-filter-footer">
                <div className="control-room-filter-quick-actions">
                  <button
                    type="button"
                    className={`control-room-inline-action${mapDate === TODAY_DATE ? " is-active" : ""}`}
                    onClick={() => setMapDate(TODAY_DATE)}
                  >
                    Bugün
                  </button>
                  <button
                    type="button"
                    className={`control-room-inline-action${mapDate === YESTERDAY_DATE ? " is-active" : ""}`}
                    onClick={() => setMapDate(YESTERDAY_DATE)}
                  >
                    Dün
                  </button>
                </div>
                <label className="control-room-toggle">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(event) =>
                      setIncludeInactive(event.target.checked)
                    }
                  />
                  <span>Pasif çalışanları da dahil et</span>
                </label>
                <button
                  type="button"
                  className="control-room-secondary-button"
                  onClick={() => {
                    setQueryText("");
                    setRegionId(null);
                    setDepartmentId(null);
                    setTodayStatus("");
                    setLocationState("");
                    setIncludeInactive(false);
                    setMapDate(TODAY_DATE);
                    setLimit(DEFAULT_LIMIT);
                  }}
                >
                  Filtreleri sıfırla
                </button>
              </div>
            </section>

            <section className="control-room-panel control-room-selected-panel">
              <div className="control-room-panel-head">
                <div>
                  <p className="control-room-panel-kicker">TARGET LOCK</p>
                  <h3>Seçili operatör</h3>
                </div>
                <div className="control-room-head-actions">
                  <button
                    type="button"
                    className="control-room-link-button"
                    disabled={!selectedEmployee}
                    onClick={() => setDetailOpen(true)}
                  >
                    Intel dosyası
                  </button>
                  {selectedEmployee ? (
                    <Link
                      to={`/employees/${selectedEmployee.employee.id}`}
                      className="control-room-link-button control-room-link-button-accent"
                    >
                      Klasik detayı aç
                    </Link>
                  ) : null}
                </div>
              </div>
              {selectedEmployee ? (
                <div className="control-room-selected-content">
                  <div className="control-room-lock-hero">
                    <div>
                      <p className="control-room-lock-id">
                        TARGET #
                        {selectedEmployee.employee.id
                          .toString()
                          .padStart(3, "0")}
                      </p>
                      <h4>{selectedEmployee.employee.full_name}</h4>
                      <p>
                        {selectedEmployee.department_name ?? "Departman yok"} /{" "}
                        {selectedEmployee.employee.region_name ?? "Bölge yok"}
                      </p>
                    </div>
                    <div className="control-room-lock-score">
                      <span>Risk puanı</span>
                      <strong>{selectedThreatScore}</strong>
                      <small>{threatLevel(selectedThreatScore)}</small>
                    </div>
                  </div>
                  <div className="control-room-chip-stack">
                    <span
                      className={statusClass(selectedEmployee.today_status)}
                    >
                      {todayLabel(selectedEmployee.today_status)}
                    </span>
                    <span className={locClass(selectedEmployee.location_state)}>
                      {locLabel(selectedEmployee.location_state)}
                    </span>
                    <span className="control-room-pill control-room-pill-neutral">
                      Portal {rel(selectedEmployee.last_portal_seen_utc)}
                    </span>
                  </div>
                  <div className="control-room-selected-grid">
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">
                        Vardiya
                      </span>
                      <strong>
                        {selectedEmployee.shift_name ?? "Atanmadı"}
                      </strong>
                      <p>
                        {selectedEmployee.shift_window_label ??
                          "Saat penceresi yok"}
                      </p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">
                        Cihaz / IP
                      </span>
                      <strong>
                        {selectedEmployee.active_devices}/
                        {selectedEmployee.total_devices} aktif
                      </strong>
                      <p>{selectedEmployee.recent_ip ?? "IP kaydı yok"}</p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">
                        Plan üstü
                      </span>
                      <strong>
                        <MinuteDisplay
                          minutes={
                            selectedEmployee.current_month.plan_overtime_minutes
                          }
                        />
                      </strong>
                      <p>Bu ay</p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">
                        Yasal FM
                      </span>
                      <strong>
                        <MinuteDisplay
                          minutes={
                            selectedEmployee.current_month.overtime_minutes
                          }
                        />
                      </strong>
                      <p>Bu ay</p>
                    </div>
                  </div>
                  <div className="control-room-selected-timeline">
                    <div>
                      <span>Son olay</span>
                      <strong>
                        {selectedEmployee.last_event
                          ? dt(selectedEmployee.last_event.ts_utc)
                          : "-"}
                      </strong>
                    </div>
                    <div>
                      <span>Konum izi</span>
                      <strong>
                        {selectedEmployee.latest_location
                          ? rel(selectedEmployee.latest_location.ts_utc)
                          : "Konum yok"}
                      </strong>
                    </div>
                    <div>
                      <span>Ek çalışma</span>
                      <strong>
                        <MinuteDisplay
                          minutes={
                            selectedEmployee.current_month.extra_work_minutes
                          }
                        />
                      </strong>
                    </div>
                  </div>
                  <div className="control-room-alert-list">
                    {selectedEmployee.attention_flags.length ? (
                      selectedEmployee.attention_flags.map((alert) => (
                        <span
                          key={alert.code}
                          className={alertClass(alert.severity)}
                        >
                          {alertText(alert.severity)} / {alert.label}
                        </span>
                      ))
                    ) : (
                      <span className="control-room-alert control-room-alert-clear">
                        Açık alarm yok
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="control-room-empty-state">
                  Bu sayfada seçilecek kayıt bulunmuyor.
                </div>
              )}
            </section>
          </div>

          {overviewQuery.isLoading && !overviewQuery.data ? (
            <LoadingBlock label="Kontrol odası yükleniyor..." />
          ) : null}
          {overviewQuery.isError ? (
            <ErrorBlock message="Kontrol odası verileri alınamadı." />
          ) : null}
          {!overviewQuery.isLoading && !overviewQuery.isError ? (
            <>
              <div className="control-room-telemetry-grid">
                <section className="control-room-panel control-room-map-panel">
                  <div className="control-room-panel-head">
                    <div>
                      <p className="control-room-panel-kicker">TACTICAL MAP</p>
                      <h3>Harita geri sarımı</h3>
                    </div>
                    <span className="control-room-inline-tag">
                      Seçili gün için, yalnızca bu sayfadaki personel
                    </span>
                  </div>
                  <div className="control-room-map-toolbar">
                    <div className="control-room-map-day-label">
                      <span>Gün etiketi</span>
                      <strong>{mapDate || "-"}</strong>
                    </div>
                    <div className="control-room-map-quick-actions">
                      <button
                        type="button"
                        className={`control-room-inline-action${mapDate === TODAY_DATE ? " is-active" : ""}`}
                        onClick={() => setMapDate(TODAY_DATE)}
                      >
                        Bugün
                      </button>
                      <button
                        type="button"
                        className={`control-room-inline-action${mapDate === YESTERDAY_DATE ? " is-active" : ""}`}
                        onClick={() => setMapDate(YESTERDAY_DATE)}
                      >
                        Dün
                      </button>
                    </div>
                  </div>
                  {mapMarkers.length ? (
                    <ControlRoomMap
                      markers={mapMarkers}
                      focusedMarkerId={
                        selectedEmployee
                          ? `employee-${selectedEmployee.employee.id}`
                          : null
                      }
                    />
                  ) : (
                    <div className="control-room-empty-map">
                      Seçili günde görünür konum kaydı yok.
                    </div>
                  )}
                </section>
                <section className="control-room-panel control-room-feed-panel">
                  <div className="control-room-panel-head">
                    <div>
                      <p className="control-room-panel-kicker">EVENT FEED</p>
                      <h3>Sayfa içi olay akışı</h3>
                    </div>
                    <span className="control-room-inline-tag">
                      {feedRows.length} satır
                    </span>
                  </div>
                  <div className="control-room-feed-filters">
                    <label className="control-room-field">
                      <span>Çalışan ara</span>
                      <input
                        value={feedQuery}
                        onChange={(event) => setFeedQuery(event.target.value)}
                        placeholder="İsim veya #ID"
                      />
                    </label>
                    <label className="control-room-field">
                      <span>Olay tipi</span>
                      <select
                        value={feedType}
                        onChange={(event) =>
                          setFeedType(event.target.value as typeof feedType)
                        }
                      >
                        <option value="">Tümü</option>
                        <option value="IN">Giriş</option>
                        <option value="OUT">Çıkış</option>
                      </select>
                    </label>
                    <label className="control-room-field">
                      <span>Konum durumu</span>
                      <select
                        value={feedLocationStatus}
                        onChange={(event) =>
                          setFeedLocationStatus(
                            event.target.value as typeof feedLocationStatus,
                          )
                        }
                      >
                        <option value="">Tümü</option>
                        <option value="VERIFIED_HOME">Doğrulandı</option>
                        <option value="UNVERIFIED_LOCATION">
                          Doğrulanamadı
                        </option>
                        <option value="NO_LOCATION">Konum yok</option>
                      </select>
                    </label>
                  </div>
                  <div className="control-room-feed-toolbar">
                    <label className="control-room-toggle">
                      <input
                        type="checkbox"
                        checked={feedOnlySelected}
                        onChange={(event) =>
                          setFeedOnlySelected(event.target.checked)
                        }
                      />
                      <span>Sadece kilitli hedefi izle</span>
                    </label>
                    <button
                      type="button"
                      className="control-room-secondary-button"
                      onClick={() => {
                        setFeedQuery("");
                        setFeedType("");
                        setFeedLocationStatus("");
                        setFeedOnlySelected(false);
                      }}
                    >
                      Feed filtrelerini sıfırla
                    </button>
                  </div>
                  <div className="control-room-feed-list">
                    {feedRows.length ? (
                      feedRows.map((event) => (
                        <button
                          key={event.event_id}
                          type="button"
                          className="control-room-feed-item"
                          onClick={() => {
                            setSelectedEmployeeId(event.employee_id);
                            setDetailOpen(true);
                          }}
                        >
                          <div className="control-room-feed-item-topline">
                            <span className="control-room-feed-time">
                              {dt(event.ts_utc)}
                            </span>
                            <span className="control-room-feed-badge">
                              {eventLabel(event.event_type)}
                            </span>
                          </div>
                          <strong>
                            #{event.employee_id} {event.employee_name}
                          </strong>
                          <span>
                            {event.department_name ?? "Departman yok"} /{" "}
                            {locationStatusLabel(event.location_status)}
                          </span>
                          <small>
                            Cihaz #{event.device_id}
                            {event.lat !== null && event.lon !== null
                              ? ` / ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`
                              : ""}
                          </small>
                        </button>
                      ))
                    ) : (
                      <div className="control-room-empty-state">
                        Feed filtresine uyan satır yok.
                      </div>
                    )}
                  </div>
                </section>
              </div>
              <section className="control-room-panel control-room-table-panel">
                <div className="control-room-panel-head">
                  <div>
                    <p className="control-room-panel-kicker">
                      SURVEILLANCE TABLE
                    </p>
                    <h3>Personel vardiya matrisi</h3>
                  </div>
                  <span className="control-room-inline-tag">
                    Scroll kilidi aktif
                  </span>
                </div>
                <div className="control-room-table-toolbar">
                  <div className="control-room-table-summary">
                    <strong>
                      {rangeStart}-{rangeEnd}
                    </strong>
                    <span>/ {total} kayıt gösteriliyor</span>
                  </div>
                  <div className="control-room-pagination">
                    <label className="control-room-mini-field">
                      <span>Limit</span>
                      <select
                        value={limit}
                        onChange={(event) =>
                          setLimit(Number(event.target.value))
                        }
                      >
                        {PAGE_LIMITS.map((pageLimit) => (
                          <option key={pageLimit} value={pageLimit}>
                            {pageLimit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="control-room-page-button"
                      disabled={page <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      Önceki
                    </button>
                    <span className="control-room-page-indicator">
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="control-room-page-button"
                      disabled={page >= totalPages}
                      onClick={() =>
                        setPage((prev) => Math.min(totalPages, prev + 1))
                      }
                    >
                      Sonraki
                    </button>
                  </div>
                </div>
                <div className="control-room-table-wrap">
                  <table
                    className="control-room-table"
                    aria-label="Personel vardiya matrisi"
                  >
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Durum</th>
                        <th>Vardiya</th>
                        <th>Son olay</th>
                        <th>Konum</th>
                        <th>Cihaz / IP</th>
                        <th>Alarm</th>
                        <th>Süreler</th>
                        <th>İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length ? (
                        items.map((item) => (
                          <tr
                            key={item.employee.id}
                            className={
                              item.employee.id === selectedEmployee?.employee.id
                                ? "is-selected"
                                : ""
                            }
                            onClick={() =>
                              setSelectedEmployeeId(item.employee.id)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedEmployeeId(item.employee.id);
                              }
                            }}
                            tabIndex={0}
                          >
                            <td>
                              <div className="control-room-person-cell">
                                <strong>
                                  #{item.employee.id} {item.employee.full_name}
                                </strong>
                                <span>
                                  {item.department_name ?? "Departman yok"} /{" "}
                                  {item.employee.region_name ?? "Bölge yok"}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <span
                                  className={statusClass(item.today_status)}
                                >
                                  {todayLabel(item.today_status)}
                                </span>
                                <span className={locClass(item.location_state)}>
                                  {locLabel(item.location_state)}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <strong>{item.shift_name ?? "Atanmadı"}</strong>
                                <small>
                                  {item.shift_window_label ??
                                    "Saat penceresi yok"}
                                </small>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <strong>
                                  {item.last_event
                                    ? dt(item.last_event.ts_utc)
                                    : "-"}
                                </strong>
                                <small>
                                  {item.last_event
                                    ? eventLabel(item.last_event.event_type)
                                    : "Olay yok"}
                                </small>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <strong>
                                  {item.latest_location
                                    ? rel(item.latest_location.ts_utc)
                                    : "Konum yok"}
                                </strong>
                                <small>
                                  {item.latest_location
                                    ? locationStatusLabel(
                                        item.latest_location.location_status,
                                      )
                                    : "Lat/Lon yok"}
                                </small>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <strong>
                                  {item.active_devices}/{item.total_devices}{" "}
                                  aktif
                                </strong>
                                <small>{item.recent_ip ?? "IP yok"}</small>
                              </div>
                            </td>
                            <td>
                              <div className="control-room-table-alerts">
                                {item.attention_flags.length ? (
                                  item.attention_flags
                                    .slice(0, 2)
                                    .map((alert) => (
                                      <span
                                        key={alert.code}
                                        className={alertClass(alert.severity)}
                                      >
                                        {alert.label}
                                      </span>
                                    ))
                                ) : (
                                  <span className="control-room-alert control-room-alert-clear">
                                    Temiz
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="control-room-cell-stack">
                                <strong>
                                  <MinuteDisplay
                                    minutes={
                                      item.current_month.plan_overtime_minutes
                                    }
                                  />
                                </strong>
                                <small>
                                  Yasal FM{" "}
                                  <MinuteDisplay
                                    minutes={
                                      item.current_month.overtime_minutes
                                    }
                                  />
                                </small>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="control-room-row-action"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedEmployeeId(item.employee.id);
                                  setDetailOpen(true);
                                }}
                              >
                                Kilitle
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9}>
                            <div className="control-room-empty-state">
                              Filtreye uyan çalışan bulunamadı.
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>
      ) : null}

      {detailOpen && selectedEmployee ? (
        <div
          className="control-room-drawer-shell"
          role="dialog"
          aria-modal="true"
          aria-label="Target lock dosyası"
        >
          <button
            type="button"
            className="control-room-drawer-backdrop"
            onClick={() => setDetailOpen(false)}
            aria-label="Detayı kapat"
          />
          <aside
            className="control-room-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="control-room-drawer-head">
              <div>
                <p className="control-room-panel-kicker">TARGET DOSYASI</p>
                <h3>{selectedEmployee.employee.full_name}</h3>
                <p>
                  #{selectedEmployee.employee.id} /{" "}
                  {selectedEmployee.department_name ?? "Departman yok"} /{" "}
                  {selectedEmployee.employee.region_name ?? "Bölge yok"}
                </p>
              </div>
              <button
                type="button"
                className="control-room-drawer-close"
                onClick={() => setDetailOpen(false)}
              >
                Kapat
              </button>
            </div>
            <div className="control-room-drawer-grid">
              <section className="control-room-drawer-card">
                <span className="control-room-selected-label">Durum</span>
                <div className="control-room-chip-stack">
                  <span className={statusClass(selectedEmployee.today_status)}>
                    {todayLabel(selectedEmployee.today_status)}
                  </span>
                  <span className={locClass(selectedEmployee.location_state)}>
                    {locLabel(selectedEmployee.location_state)}
                  </span>
                </div>
                <p className="control-room-drawer-note">
                  Risk seviyesi: {threatLevel(selectedThreatScore)} / Puan{" "}
                  {selectedThreatScore}
                </p>
              </section>
              <section className="control-room-drawer-card">
                <span className="control-room-selected-label">İz bilgisi</span>
                <strong>{selectedEmployee.recent_ip ?? "IP yok"}</strong>
                <p className="control-room-drawer-note">
                  Portal izi {dt(selectedEmployee.last_portal_seen_utc)}
                </p>
              </section>
              <section className="control-room-drawer-card">
                <span className="control-room-selected-label">
                  Mesai blokları
                </span>
                <strong>
                  Plan üstü{" "}
                  <MinuteDisplay
                    minutes={
                      selectedEmployee.current_month.plan_overtime_minutes
                    }
                  />
                </strong>
                <p className="control-room-drawer-note">
                  Yasal FM{" "}
                  <MinuteDisplay
                    minutes={selectedEmployee.current_month.overtime_minutes}
                  />{" "}
                  / Ek çalışma{" "}
                  <MinuteDisplay
                    minutes={selectedEmployee.current_month.extra_work_minutes}
                  />
                </p>
              </section>
              <section className="control-room-drawer-card">
                <span className="control-room-selected-label">Cihazlar</span>
                <strong>
                  {selectedEmployee.active_devices}/
                  {selectedEmployee.total_devices} aktif
                </strong>
                <p className="control-room-drawer-note">
                  Vardiya: {selectedEmployee.shift_name ?? "Atanmadı"} /{" "}
                  {selectedEmployee.shift_window_label ?? "Saat penceresi yok"}
                </p>
              </section>
            </div>
            <section className="control-room-drawer-section">
              <div className="control-room-drawer-section-head">
                <h4>Son olay ve koordinatlar</h4>
                <Link
                  to={`/employees/${selectedEmployee.employee.id}`}
                  className="control-room-link-button control-room-link-button-accent"
                >
                  Çalışan sayfasına git
                </Link>
              </div>
              <div className="control-room-drawer-grid control-room-drawer-grid-tight">
                <div className="control-room-drawer-card">
                  <span className="control-room-selected-label">
                    Son attendance
                  </span>
                  <strong>
                    {selectedEmployee.last_event
                      ? dt(selectedEmployee.last_event.ts_utc)
                      : "-"}
                  </strong>
                  <p className="control-room-drawer-note">
                    {selectedEmployee.last_event
                      ? eventLabel(selectedEmployee.last_event.event_type)
                      : "Olay yok"}
                  </p>
                </div>
                <div className="control-room-drawer-card">
                  <span className="control-room-selected-label">Son konum</span>
                  <strong>
                    {selectedEmployee.latest_location
                      ? `${selectedEmployee.latest_location.lat.toFixed(5)}, ${selectedEmployee.latest_location.lon.toFixed(5)}`
                      : "Konum yok"}
                  </strong>
                  <p className="control-room-drawer-note">
                    {selectedEmployee.latest_location
                      ? `${locationStatusLabel(selectedEmployee.latest_location.location_status)} / ${rel(selectedEmployee.latest_location.ts_utc)}`
                      : "Koordinat üretilmedi"}
                  </p>
                </div>
              </div>
            </section>
            <section className="control-room-drawer-section">
              <div className="control-room-drawer-section-head">
                <h4>Alarm dizisi</h4>
              </div>
              <div className="control-room-alert-list">
                {selectedEmployee.attention_flags.length ? (
                  selectedEmployee.attention_flags.map((alert) => (
                    <span
                      key={alert.code}
                      className={alertClass(alert.severity)}
                    >
                      {alertText(alert.severity)} / {alert.label}
                    </span>
                  ))
                ) : (
                  <span className="control-room-alert control-room-alert-clear">
                    Alarm kaydı yok
                  </span>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
