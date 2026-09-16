'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api-client';
import { Header } from '../../components/Header';
import type {
  Branch,
  Service,
  Staff,
  AvailabilityResponse,
  AvailabilitySlot,
  Booking,
} from '../../lib/types';

type Step = 'branch' | 'service' | 'staff' | 'slot' | 'confirm' | 'done';

// P0 — back navigation. `done` has no "back" (its own "Hacer otra
// reserva" / "Volver al dashboard" buttons cover that); `branch` has no
// back either (it's the first real step — Header's Dashboard link is
// "leave the wizard entirely", a back button here would be redundant).
const PREVIOUS_STEP: Partial<Record<Step, Step>> = {
  service: 'branch',
  staff: 'service',
  slot: 'staff',
  confirm: 'slot',
};

const STEP_LABEL: Record<Step, string> = {
  branch: '1. Elegí una sucursal',
  service: '2. Elegí un servicio',
  staff: '3. Elegí con quién',
  slot: '4. Elegí fecha y horario',
  confirm: '5. Confirmar',
  done: 'Listo',
};

// Defaults to today's real date. Test suites use a fixed reference Monday
// (2026-09-14) so slot boundaries are deterministic; a live public demo
// has no such luxury — a recruiter opens this on whatever real calendar
// date it happens to be, so it must reflect that, not a value pinned to
// this project's test fixtures.
function todayAsDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPrice(price: string | number): string {
  const n = typeof price === 'string' ? Number(price) : price;
  if (Number.isNaN(n)) return String(price);
  return `$${n.toLocaleString('es')}`;
}

function BookPageContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('branch');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [date, setDate] = useState(todayAsDateString);

  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [branchQuery, setBranchQuery] = useState('');
  const [branchVisible, setBranchVisible] = useState(8);
  const preselectApplied = useRef(false);

  // P0 — a branch card on the dashboard links to /book?branchId=<id>.
  // Once the branches list loads, if that param is present, auto-advance
  // straight to Step 2 for that branch instead of making the person
  // re-click a branch they already picked on the previous screen.
  const preselectBranchId = searchParams.get('branchId');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    apiFetch('/branches')
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /branches -> ${res.status}`);
        const list: Branch[] = await res.json();
        setBranches(list);

        if (preselectBranchId && !preselectApplied.current) {
          const match = list.find((b) => b.id === preselectBranchId);
          if (match) {
            preselectApplied.current = true;
            chooseBranch(match);
          }
        }
      })
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  function chooseBranch(branch: Branch) {
    setSelectedBranch(branch);
    setError(null);
    apiFetch(`/services?branchId=${branch.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /services -> ${res.status}`);
        setServices(await res.json());
        setStep('service');
      })
      .catch((err: Error) => setError(err.message));
  }

  function chooseService(service: Service) {
    setSelectedService(service);
    setError(null);
    if (!selectedBranch) return;
    apiFetch(`/staff?branchId=${selectedBranch.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /staff -> ${res.status}`);
        const all: Staff[] = await res.json();
        // Only staff qualified for the chosen service — same StaffService
        // join the backend itself checks in BookingsService.create;
        // filtering here is purely for UX, not a security boundary (the
        // API re-validates regardless).
        const qualified = all.filter((s) =>
          s.services.some((a) => a.service.id === service.id),
        );
        setStaffList(qualified);
        setStep('staff');
      })
      .catch((err: Error) => setError(err.message));
  }

  function chooseStaff(staff: Staff) {
    setSelectedStaff(staff);
    setError(null);
    setStep('slot');
    loadAvailability(staff.id, date);
  }

  function loadAvailability(staffId: string, forDate: string) {
    if (!selectedService) return;
    setAvailability(null);
    // NOTE — deliberately does NOT clear `error` here. confirmBooking's
    // 409 handler calls this to refresh the grid while KEEPING its
    // conflict message visible; callers that DO want a clean slate
    // (chooseStaff, handleDateChange) clear the error themselves before
    // calling this.
    apiFetch(`/availability?staffId=${staffId}&serviceId=${selectedService.id}&date=${forDate}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `GET /availability -> ${res.status}`);
        }
        setAvailability(await res.json());
      })
      .catch((err: Error) => setError(err.message));
  }

  function handleDateChange(newDate: string) {
    setDate(newDate);
    setError(null);
    if (selectedStaff) loadAvailability(selectedStaff.id, newDate);
  }

  function chooseSlot(slot: AvailabilitySlot) {
    setSelectedSlot(slot);
    setError(null);
    setStep('confirm');
  }

  // P0 — go back one step. Lists already fetched (services/staff) stay in
  // state so going forward again doesn't refetch. Selections that belong
  // to the step we are leaving ARE cleared, otherwise the summary chips
  // keep showing e.g. "Corte de cabello" while the user is back on
  // "elegí un servicio".
  function goBack() {
    const previous = PREVIOUS_STEP[step];
    if (!previous) return;
    setError(null);
    if (step === 'service') {
      setSelectedBranch(null);
    }
    if (step === 'staff') {
      setSelectedService(null);
      setSelectedStaff(null);
      setSelectedSlot(null);
      setAvailability(null);
    }
    if (step === 'slot') {
      setSelectedStaff(null);
      setSelectedSlot(null);
      setAvailability(null);
    }
    if (step === 'confirm') {
      setSelectedSlot(null);
    }
    setStep(previous);
  }

  async function confirmBooking() {
    if (!selectedStaff || !selectedService || !selectedSlot) return;
    setSubmitting(true);
    setError(null);

    const res = await apiFetch('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        staffId: selectedStaff.id,
        serviceId: selectedService.id,
        startTime: selectedSlot.startUtc,
      }),
    });

    setSubmitting(false);

    if (res.status === 201) {
      setCreatedBooking(await res.json());
      setStep('done');
      return;
    }

    if (res.status === 409) {
      // Someone else took this exact slot between us loading availability
      // and submitting — the exact race the exclusion constraint exists
      // to resolve. Refresh availability so the now-stale slot disappears
      // and the person can pick a different one, instead of a dead end.
      setError('Ese horario acaba de ser tomado por otra persona. Elegí otro horario disponible.');
      setSelectedSlot(null);
      setStep('slot');
      loadAvailability(selectedStaff.id, date);
      return;
    }

    const body = await res.json().catch(() => ({}));
    setError(body.message ?? `No se pudo crear la reserva (${res.status}).`);
  }

  function reset() {
    setStep('branch');
    setSelectedBranch(null);
    setSelectedService(null);
    setSelectedStaff(null);
    setSelectedSlot(null);
    setAvailability(null);
    setCreatedBooking(null);
    setError(null);
  }

  if (isLoading || !isAuthenticated) {
    return <main className="p-8">Cargando...</main>;
  }

  const q = branchQuery.trim().toLowerCase();
  const filteredBranches = q
    ? branches.filter((b) => b.name.toLowerCase().includes(q))
    : branches;
  const shownBranches = filteredBranches.slice(0, branchVisible);
  const branchRemaining = filteredBranches.length - shownBranches.length;

  return (
    <main className="mx-auto max-w-xl p-8">
      <Header />

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Nueva reserva</h1>
        {/* P0 — was completely absent: no way back to a previous step, no
            way out except the browser's own back button. */}
        {PREVIOUS_STEP[step] && (
          <button onClick={goBack} className="text-sm text-gray-500 underline hover:text-black">
            ← Atrás
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-sm text-gray-500">
        {selectedBranch && step !== 'branch' && (
          <span className="rounded bg-gray-100 px-2 py-1">{selectedBranch.name}</span>
        )}
        {selectedService && (step === 'staff' || step === 'slot' || step === 'confirm' || step === 'done') && (
          <span className="rounded bg-gray-100 px-2 py-1">{selectedService.name}</span>
        )}
        {selectedStaff && (step === 'slot' || step === 'confirm' || step === 'done') && (
          <span className="rounded bg-gray-100 px-2 py-1">{selectedStaff.user.email}</span>
        )}
      </div>

      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {step === 'branch' && (
        <section>
          <h2 className="mb-2 font-medium">{STEP_LABEL.branch}</h2>
          {branches.length > 8 && (
            <input
              type="search"
              value={branchQuery}
              onChange={(e) => {
                setBranchQuery(e.target.value);
                setBranchVisible(8);
              }}
              placeholder="Buscar sucursal…"
              className="mb-3 w-full rounded-md border px-3 py-1.5 text-sm"
            />
          )}
          <ul className="space-y-2">
            {shownBranches.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => chooseBranch(b)}
                  className="w-full rounded-lg border p-3 text-left hover:bg-gray-50"
                >
                  {b.name}
                </button>
              </li>
            ))}
            {branches.length === 0 && <p className="text-sm text-gray-500">Cargando...</p>}
          </ul>
          {branchRemaining > 0 && (
            <button
              type="button"
              onClick={() => setBranchVisible((n) => n + 8)}
              className="mt-3 w-full rounded-md border py-2 text-sm hover:bg-gray-50"
            >
              Ver más ({branchRemaining} restantes)
            </button>
          )}
        </section>
      )}

      {step === 'service' && (
        <section>
          <h2 className="mb-2 font-medium">{STEP_LABEL.service}</h2>
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => chooseService(s)}
                  className="w-full rounded border p-3 text-left hover:bg-gray-50"
                >
                  <p>{s.name}</p>
                  <p className="text-sm text-gray-500">
                    {s.durationMinutes} min · {formatPrice(s.price)}
                  </p>
                </button>
              </li>
            ))}
            {services.length === 0 && (
              <p className="text-sm text-gray-500">Esta sucursal no tiene servicios todavía.</p>
            )}
          </ul>
        </section>
      )}

      {step === 'staff' && (
        <section>
          <h2 className="mb-2 font-medium">{STEP_LABEL.staff}</h2>
          <ul className="space-y-2">
            {staffList.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => chooseStaff(s)}
                  className="w-full rounded border p-3 text-left hover:bg-gray-50"
                >
                  {s.user.email}
                </button>
              </li>
            ))}
            {staffList.length === 0 && (
              <p className="text-sm text-gray-500">
                Nadie en esta sucursal está calificado para este servicio todavía.
              </p>
            )}
          </ul>
        </section>
      )}

      {step === 'slot' && (
        <section>
          <h2 className="mb-2 font-medium">{STEP_LABEL.slot}</h2>
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="mb-4 rounded border px-3 py-2"
          />

          {availability === null && <p className="text-sm text-gray-500">Cargando horarios...</p>}

          {availability !== null && (
            <>
              {availability.slots.length === 0 && (
                <p className="text-sm text-gray-500">Sin horarios disponibles este día.</p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {availability.slots.map((slot) => (
                  <button
                    key={slot.startUtc}
                    onClick={() => chooseSlot(slot)}
                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    {slot.startLocal}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {step === 'confirm' && selectedSlot && (
        <section>
          <h2 className="mb-2 font-medium">{STEP_LABEL.confirm}</h2>
          <div className="mb-4 space-y-1 rounded border p-4 text-sm">
            <p><strong>Sucursal:</strong> {selectedBranch?.name}</p>
            <p><strong>Servicio:</strong> {selectedService?.name}</p>
            <p><strong>Con:</strong> {selectedStaff?.user.email}</p>
            <p><strong>Fecha:</strong> {date}</p>
            <p>
              <strong>Horario:</strong> {selectedSlot.startLocal} - {selectedSlot.endLocal}
            </p>
          </div>
          <button
            onClick={confirmBooking}
            disabled={submitting}
            className="w-full rounded bg-black py-2 text-white disabled:opacity-50"
          >
            {submitting ? 'Reservando...' : 'Confirmar reserva'}
          </button>
        </section>
      )}

      {step === 'done' && createdBooking && (
        <section className="rounded border border-green-200 bg-green-50 p-4">
          <p className="font-medium text-green-800">
            Reserva creada — estado: {createdBooking.status}
          </p>
          <p className="mt-1 text-sm text-green-700">
            El estado inicial es siempre PENDING; se confirma desde el panel administrativo.
          </p>
          <div className="mt-4 flex gap-4">
            <button onClick={reset} className="text-sm underline">
              Hacer otra reserva
            </button>
            <Link href="/dashboard" className="text-sm underline">
              Volver al dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

// useSearchParams() (used above, for the ?branchId= dashboard deep link)
// requires a Suspense boundary around any component that calls it directly
// as a page's default export in App Router — without this, `next build`
// either fails or silently de-opts the whole route to client-only
// rendering with a build warning. The fallback is intentionally the same
// "Cargando..." used elsewhere for the auth-check loading state, so there
// is no visible difference to the brief Suspense flash.
export default function BookPage() {
  return (
    <Suspense fallback={<main className="p-8">Cargando...</main>}>
      <BookPageContent />
    </Suspense>
  );
}
