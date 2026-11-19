export interface Branch {
  id: string;
  name: string;
  timezone: string;
}

export interface Service {
  id: string;
  branchId: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: string;
}

export interface StaffServiceAssignment {
  service: { id: string; name: string };
}

export interface Staff {
  id: string;
  branchId: string;
  user: { id: string; email: string };
  services: StaffServiceAssignment[];
}

export interface AvailabilitySlot {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
}

export interface AvailabilityResponse {
  date: string;
  staffId: string;
  serviceId: string;
  timezone: string;
  slotMinutes: number;
  branchScheduleApplied: boolean;
  slots: AvailabilitySlot[];
}

export interface Booking {
  id: string;
  staffId: string;
  serviceId: string;
  branchId: string;
  clientId: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  createdAt: string;
  // Included by GET /bookings but not by the POST /bookings response.
  branch?: { name: string };
  service?: { name: string };
  staff?: { user: { email: string } };
  client?: { email: string };
}

// Mirrors apps/api/src/auth/types/jwt-payload.type.ts's AuthenticatedUser.
// The frontend has no access to @prisma/client's Role enum (that's a
// backend-only dependency), so this is a plain string union kept in sync
// by hand — same trade-off already accepted for Booking['status'] above.
export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'STAFF' | 'CLIENT';

export interface AuthUser {
  id: string;
  role: Role;
  tenantId: string | null;
}
