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
}
