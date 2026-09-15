'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api-client';
import type {
  Branch,
  Service,
  Staff,
  AvailabilityResponse,
  AvailabilitySlot,
  Booking,
} from '../../lib/types';

type Step = 'branch' | 'service' | 'staff' | 'slot' | 'confirm' | 'done';

// Today, hardcoded to the project's reference date so slots line up with
// the seeded staff schedules used throughout the backend's own e2e tests
// (Monday 2026-09-14). A real deployment would default to `new Date()`.
const DEFAULT_DATE = '2026-09-14';

export default function BookPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('branch');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [date, setDate] = useState(DEFAULT_DATE);

  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // --- Step 1: branches ---
  useEffect(() => {
    if (!isAuthenticated) return;
    apiFetch('/branches')
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /branches -> ${res.status}`);
        setBranches(await res.json());
      })
      .catch((err: Error) => setError(err.message));
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

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-6 text-xl font-semibold">Nueva reserva</h1>

      <div className="mb-4 flex flex-wrap gap-2 text-sm text-gray-500">
        {selectedBranch && <span className="rounded bg-gray-100 px-2 py-1">{selectedBranch.name}</span>}
        {selectedService && <span className="rounded bg-gray-100 px-2 py-1">{selectedService.name}</span>}
        {selectedStaff && (
          <span className="rounded bg-gray-100 px-2 py-1">{selectedStaff.user.email}</span>
        )}
      </div>

      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {step === 'branch' && (
        <section>
          <h2 className="mb-2 font-medium">1. Elegí una sucursal</h2>
          <ul className="space-y-2">
            {branches.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => chooseBranch(b)}
                  className="w-full rounded border p-3 text-left hover:bg-gray-50"
                >
                  {b.name}
                </button>
              </li>
            ))}
            {branches.length === 0 && <p className="text-sm text-gray-500">Cargando...</p>}
          </ul>
        </section>
      )}

      {step === 'service' && (
        <section>
          <h2 className="mb-2 font-medium">2. Elegí un servicio</h2>
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => chooseService(s)}
                  className="w-full rounded border p-3 text-left hover:bg-gray-50"
                >
                  <p>{s.name}</p>
                  <p className="text-sm text-gray-500">
                    {s.durationMinutes} min · ${s.price}
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
          <h2 className="mb-2 font-medium">3. Elegí con quién</h2>
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
          <h2 className="mb-2 font-medium">4. Elegí fecha y horario</h2>
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
          <h2 className="mb-2 font-medium">5. Confirmar</h2>
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
          <button onClick={reset} className="mt-4 text-sm underline">
            Hacer otra reserva
          </button>
        </section>
      )}
    </main>
  );
}
