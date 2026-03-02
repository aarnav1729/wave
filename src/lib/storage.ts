// storage.ts
// Browser storage utilities for WAVE MVP
// - Local-first cache for snappy UX
// - Best-effort sync with backend (Node + MSSQL)
// - Safe guards for SSR / private mode / storage quota issues

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Employee {
  empid: string;
  empemail: string;
  empname: string;
  dept: string;
  subdept: string;
  emplocation: string;
  designation: string;
  activeflag: number;
  managerid: string;
}

export interface Guest {
  name: string;
  number: string;
  email: string;
  company: string;
  designation: string;

  // base64/dataURL optional
  picture?: string;

  // generated per ticket + index
  qrCode?: string;

  // gate-side usage (optional future)
  checkedIn?: boolean;
  checkInTime?: string;
  checkOutTime?: string;
}

export interface Approval {
  approverId: string;
  approverEmail: string;
  status: "pending" | "approved" | "declined";
  timestamp?: string;
  reason?: string;
  allottedPerson?: string;
  approvalGroup?: string;
  groupMode?: "all" | "any";
}

export interface VisitRequest {
  ticketNumber: string;
  empDetails: Employee;

  visitorCategory: string;
  visitorCategoryOther?: string;

  numberOfGuests: number;
  guests: Guest[];

  purposeOfVisit: string;

  // UI uses datetime-local string, backend may store ISO
  tentativeArrival: string;

  // UI normalizes to numeric hours string
  tentativeDuration: string;

  lunchRequired: boolean;
  lunchCategory?: string;
  dietaryRequirements?: string;

  meetingWith: string;

  // Stored as comma-separated list
  typeOfLocation: string; // e.g. "Plant", "Plant,Warehouse"
  locationToVisit: string; // e.g. "Fabcity-P2-..., Annaram"
  selectedLocationIds?: number[];
  workflowSetId?: number;

  areaToVisit: string;

  cellLineVisit: boolean;

  vehicleRequired: boolean;
  vehicleNumber?: string;

  visitorTagNumber?: string;

  anythingElse?: string;
  attachments?: string[];

  creationDatetime: string;

  status: "pending" | "approved" | "declined";
  approvals: Approval[];
  currentApproverIndex: number;
}

export interface HistoryEntry {
  ticketNumber: string;
  userId: string;
  comment: string;
  actionType: string;
  beforeState: string;
  afterState: string;
  timestamp: string;
}

// -----------------------------------------------------------------------------
// Storage keys + environment safety
// -----------------------------------------------------------------------------

const STORAGE_KEYS = {
  EMPLOYEES: "wave_employees",
  REQUESTS: "wave_requests",
  GUESTS: "wave_guests",
  HISTORY: "wave_history",
  CURRENT_USER: "wave_current_user",
  OTP: "wave_otp",

  // optional schema/versioning guard
  SCHEMA_VERSION: "wave_schema_v",
} as const;

const SCHEMA_VERSION = 1;

const isBrowser =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

// Helper: same-origin API base (Node serves SPA + API)
const api = (path: string) => `/api${path}`;

// -----------------------------------------------------------------------------
// Safe localStorage helpers
// -----------------------------------------------------------------------------

const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readLS = <T>(key: string, fallback: T): T => {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return safeParse<T>(raw, fallback);
  } catch {
    return fallback;
  }
};

const writeLS = (key: string, value: unknown) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota exceeded or storage blocked
    console.error(`[storage] localStorage write failed for ${key}:`, err);
  }
};

const removeLS = (key: string) => {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
};

const ensureSchemaVersion = () => {
  if (!isBrowser) return;
  const existing = readLS<number>(STORAGE_KEYS.SCHEMA_VERSION, 0);
  if (existing !== SCHEMA_VERSION) {
    // Non-destructive bump: we only set version.
    // If you ever need a breaking migration, do it here.
    writeLS(STORAGE_KEYS.SCHEMA_VERSION, SCHEMA_VERSION);
  }
};

// -----------------------------------------------------------------------------
// Default employees as a fallback ONLY if API is unreachable
// -----------------------------------------------------------------------------

const DEFAULT_EMPLOYEES: Employee[] = [
  {
    empid: "PEPPL0874",
    empemail: "aarnav.singh@premierenergies.com",
    empname: "Aarnav Singh",
    dept: "IT",
    subdept: "IT",
    emplocation: "Corporate Office",
    designation: "Senior Executive",
    activeflag: 1,
    managerid: "PSS1431",
  },
  {
    empid: "PSS1431",
    empemail: "ramesh.t@premierenergies.com",
    empname: "Tangirala Ramesh",
    dept: "IT",
    subdept: "IT",
    emplocation: "Corporate Office",
    designation: "General Manager - Systems & Infrastructure",
    activeflag: 1,
    managerid: "PSS1373",
  },
  {
    empid: "PEPPL0548",
    empemail: "chandra.kumar@premierenergies.com",
    empname: "Chandra Mauli Kumar",
    dept: "Production",
    subdept: "Production",
    emplocation: "Fabcity",
    designation: "Chief Production Officer",
    activeflag: 1,
    managerid: "10000",
  },
  {
    empid: "10000",
    empemail: "saluja@premierenergies.com",
    empname: "Chiranjeev Singh",
    dept: "Management",
    subdept: "Management",
    emplocation: "Corporate Office",
    designation: "Managing Director",
    activeflag: 1,
    managerid: "10001",
  },
];

const seedDefaultEmployeesIfEmpty = () => {
  const existing = getEmployees();
  if (existing.length === 0) {
    writeLS(STORAGE_KEYS.EMPLOYEES, DEFAULT_EMPLOYEES);
  }
};

// -----------------------------------------------------------------------------
// initializeDefaultData
// - pulls from BACKEND and falls back to defaults
// -----------------------------------------------------------------------------

export const initializeDefaultData = async () => {
  ensureSchemaVersion();

  // 1) Employees from DB
  try {
    const res = await fetch(api("/employees"), { credentials: "include" });
    if (res.ok) {
      const json = await res.json();
      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : null;

      if (Array.isArray(data)) {
        writeLS(STORAGE_KEYS.EMPLOYEES, data);
      } else {
        seedDefaultEmployeesIfEmpty();
      }
    } else {
      console.error(
        "[initializeDefaultData] /api/employees failed with status",
        res.status
      );
      seedDefaultEmployeesIfEmpty();
    }
  } catch (err) {
    console.error(
      "[initializeDefaultData] Failed to fetch employees from API:",
      err
    );
    seedDefaultEmployeesIfEmpty();
  }

  // 2) Requests from DB
  try {
    const res = await fetch(api("/requests"), { credentials: "include" });
    if (res.ok) {
      const json = await res.json();
      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : null;

      if (Array.isArray(data)) {
        writeLS(STORAGE_KEYS.REQUESTS, data);
        // Also hydrate guests local cache for offline lookups
        try {
          const allGuests: Guest[] = [];
          for (const r of data as VisitRequest[]) {
            if (Array.isArray((r as any)?.guests)) {
              allGuests.push(...((r as any).guests as Guest[]));
            }
          }
          if (allGuests.length) {
            mergeGuestsIntoLocal(allGuests);
          }
        } catch {
          /* noop */
        }
      }
    } else {
      console.error(
        "[initializeDefaultData] /api/requests failed with status",
        res.status
      );
    }
  } catch (err) {
    console.error(
      "[initializeDefaultData] Failed to fetch requests from API:",
      err
    );
  }

  // 3) Guests (optional endpoint; safe if not implemented)
  try {
    const res = await fetch(api("/guests"), { credentials: "include" });
    if (res.ok) {
      const json = await res.json();
      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : null;
      if (Array.isArray(data)) {
        writeLS(STORAGE_KEYS.GUESTS, data);
      }
    }
  } catch {
    // silently ignore if endpoint not present
  }

  // 4) HISTORY:
  // local-only cache; we push changes to backend when they occur.
};

// -----------------------------------------------------------------------------
// Employee operations
// -----------------------------------------------------------------------------

export const getEmployees = (): Employee[] => {
  return readLS<Employee[]>(STORAGE_KEYS.EMPLOYEES, []);
};

export const getEmployeeByEmail = (email: string): Employee | null => {
  const employees = getEmployees();
  return employees.find((emp) => emp.empemail === email) || null;
};

export const getEmployeeById = (empid: string): Employee | null => {
  const employees = getEmployees();
  return employees.find((emp) => emp.empid === empid) || null;
};

// -----------------------------------------------------------------------------
// Guest operations (local cache + optional best-effort sync)
// -----------------------------------------------------------------------------

export const getGuests = (): Guest[] => {
  return readLS<Guest[]>(STORAGE_KEYS.GUESTS, []);
};

export const getGuestByNumberLocal = (number: string): Guest | null => {
  const digits = (number || "").trim();
  if (!digits) return null;
  const guests = getGuests();
  return guests.find((g) => (g.number || "").trim() === digits) || null;
};

const normalizeGuestForCache = (g: Guest): Guest => ({
  name: g.name || "",
  number: g.number || "",
  email: g.email || "",
  company: g.company || "",
  designation: g.designation || "",
  picture: g.picture || "",
  qrCode: g.qrCode,
  checkedIn: g.checkedIn,
  checkInTime: g.checkInTime,
  checkOutTime: g.checkOutTime,
});

const mergeGuestsIntoLocal = (incoming: Guest[]) => {
  if (!incoming?.length) return;

  const existing = getGuests();
  const map = new Map<string, Guest>();

  for (const g of existing) {
    const key = (g.number || "").trim();
    if (key) map.set(key, normalizeGuestForCache(g));
  }

  for (const g of incoming) {
    const key = (g.number || "").trim();
    if (!key) continue;

    const prev = map.get(key);
    const next = normalizeGuestForCache(g);

    // Prefer richer data when merging
    map.set(key, {
      ...prev,
      ...next,
      name: next.name || prev?.name || "",
      email: next.email || prev?.email || "",
      company: next.company || prev?.company || "",
      designation: next.designation || prev?.designation || "",
      picture: next.picture || prev?.picture || "",
    });
  }

  writeLS(STORAGE_KEYS.GUESTS, Array.from(map.values()));
};

export const upsertGuestLocal = (guest: Guest) => {
  mergeGuestsIntoLocal([guest]);
};

export const upsertGuest = (guest: Guest) => {
  // local first
  upsertGuestLocal(guest);

  // optional backend sync (safe if endpoint not present)
  try {
    fetch(api("/guests"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(guest),
    }).catch((err) => {
      // do not fail UI
      console.error("[upsertGuest] Failed to sync guest to API:", err);
    });
  } catch (err) {
    console.error("[upsertGuest] Error calling API:", err);
  }
};

// -----------------------------------------------------------------------------
// Request operations
// -----------------------------------------------------------------------------

export const getRequests = (): VisitRequest[] => {
  return readLS<VisitRequest[]>(STORAGE_KEYS.REQUESTS, []);
};

export const getRequestByTicketNumber = (
  ticketNumber: string
): VisitRequest | null => {
  const requests = getRequests();
  return requests.find((req) => req.ticketNumber === ticketNumber) || null;
};

export const saveRequest = (request: VisitRequest) => {
  // Update local cache (used by UI)
  const requests = getRequests();
  const index = requests.findIndex(
    (req) => req.ticketNumber === request.ticketNumber
  );

  if (index >= 0) {
    requests[index] = request;
  } else {
    requests.push(request);
  }

  writeLS(STORAGE_KEYS.REQUESTS, requests);

  // Extract guests to local guest cache for offline "returning guest" UX
  try {
    if (Array.isArray(request.guests) && request.guests.length) {
      mergeGuestsIntoLocal(request.guests);
    }
  } catch {
    /* noop */
  }

  // Best-effort sync with backend API (MSSQL)
  try {
    fetch(api("/requests"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = await res.json().catch(() => null);
        return json?.data as VisitRequest | null;
      })
      .then((serverRequest) => {
        if (!serverRequest) return;
        const latest = getRequests();
        const idx = latest.findIndex(
          (r) => r.ticketNumber === serverRequest.ticketNumber
        );
        if (idx >= 0) latest[idx] = serverRequest;
        else latest.push(serverRequest);
        writeLS(STORAGE_KEYS.REQUESTS, latest);
      })
      .catch((err) => {
        console.error("[saveRequest] Failed to sync request to API:", err);
      });
  } catch (err) {
    console.error("[saveRequest] Error calling API:", err);
  }
};

export const generateTicketNumber = (): string => {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const requests = getRequests();
  const todayRequests = requests.filter((req) =>
    req.ticketNumber.includes(date)
  );
  const sequential = String(todayRequests.length + 1).padStart(3, "0");
  return `WAVE-${date}-${sequential}`;
};

// -----------------------------------------------------------------------------
// History operations
// -----------------------------------------------------------------------------

export const getHistory = (): HistoryEntry[] => {
  return readLS<HistoryEntry[]>(STORAGE_KEYS.HISTORY, []);
};

export const getHistoryByTicketNumber = (
  ticketNumber: string
): HistoryEntry[] => {
  const history = getHistory();
  return history.filter((entry) => entry.ticketNumber === ticketNumber);
};

export const addHistoryEntry = (entry: HistoryEntry) => {
  // Local cache
  const history = getHistory();
  history.push(entry);
  writeLS(STORAGE_KEYS.HISTORY, history);

  // Sync to backend HistoryEntries table
  try {
    fetch(api("/history"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(entry),
    }).catch((err) => {
      console.error("[addHistoryEntry] Failed to sync history to API:", err);
    });
  } catch (err) {
    console.error("[addHistoryEntry] Error calling API:", err);
  }
};

// -----------------------------------------------------------------------------
// Current user operations
// -----------------------------------------------------------------------------

export const getCurrentUser = (): Employee | null => {
  return readLS<Employee | null>(STORAGE_KEYS.CURRENT_USER, null);
};

export const setCurrentUser = (employee: Employee | null) => {
  if (employee) {
    writeLS(STORAGE_KEYS.CURRENT_USER, employee);
  } else {
    removeLS(STORAGE_KEYS.CURRENT_USER);
  }
};

// -----------------------------------------------------------------------------
// OTP operations (frontend-only as requested)
// -----------------------------------------------------------------------------

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const saveOTP = (email: string, otp: string) => {
  const otpData = { email, otp, timestamp: Date.now() };
  writeLS(STORAGE_KEYS.OTP, otpData);
};

export const verifyOTP = (email: string, otp: string): boolean => {
  const otpData = readLS<{
    email: string;
    otp: string;
    timestamp: number;
  } | null>(STORAGE_KEYS.OTP, null);

  if (!otpData) return false;

  // OTP valid for 10 minutes
  const isValid =
    otpData.email === email &&
    otpData.otp === otp &&
    Date.now() - otpData.timestamp < 600000;

  if (isValid) {
    removeLS(STORAGE_KEYS.OTP);
  }

  return isValid;
};

// -----------------------------------------------------------------------------
// QR code helper (no backend dependency)
// New format: WAVE-date-seqOfRequests-GUEST-seqOfGuests (guests 1-based)
// Example: ticketNumber = "WAVE-20250118-001" -> "WAVE-20250118-001-GUEST-1"
// -----------------------------------------------------------------------------

export const generateQRCode = (
  ticketNumber: string,
  guestIndex: number
): string => {
  const guestNumber = guestIndex + 1; // 1-based for display
  return `${ticketNumber}-GUEST-${guestNumber}`;
};

// -----------------------------------------------------------------------------
// Utility / maintenance helpers (optional but handy)
// -----------------------------------------------------------------------------

export const clearWaveLocalCache = () => {
  removeLS(STORAGE_KEYS.EMPLOYEES);
  removeLS(STORAGE_KEYS.REQUESTS);
  removeLS(STORAGE_KEYS.GUESTS);
  removeLS(STORAGE_KEYS.HISTORY);
  removeLS(STORAGE_KEYS.CURRENT_USER);
  removeLS(STORAGE_KEYS.OTP);
  removeLS(STORAGE_KEYS.SCHEMA_VERSION);
};

export const refreshEmployeesFromApi = async (): Promise<Employee[]> => {
  try {
    const res = await fetch(api("/employees"), { credentials: "include" });
    if (!res.ok) throw new Error(`employees fetch failed: ${res.status}`);
    const json = await res.json();
    const data = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : [];
    if (Array.isArray(data)) {
      writeLS(STORAGE_KEYS.EMPLOYEES, data);
      return data as Employee[];
    }
  } catch (err) {
    console.error("[refreshEmployeesFromApi] failed:", err);
  }
  const fallback = getEmployees();
  if (!fallback.length) seedDefaultEmployeesIfEmpty();
  return getEmployees();
};

export const refreshRequestsFromApi = async (): Promise<VisitRequest[]> => {
  try {
    const res = await fetch(api("/requests"), { credentials: "include" });
    if (!res.ok) throw new Error(`requests fetch failed: ${res.status}`);
    const json = await res.json();
    const data = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : [];
    if (Array.isArray(data)) {
      writeLS(STORAGE_KEYS.REQUESTS, data);
      try {
        const allGuests: Guest[] = [];
        for (const r of data as VisitRequest[]) {
          if (Array.isArray((r as any)?.guests)) {
            allGuests.push(...((r as any).guests as Guest[]));
          }
        }
        if (allGuests.length) mergeGuestsIntoLocal(allGuests);
      } catch {
        /* noop */
      }
      return data as VisitRequest[];
    }
  } catch (err) {
    console.error("[refreshRequestsFromApi] failed:", err);
  }
  return getRequests();
};
