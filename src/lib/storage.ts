// Browser storage utilities for WAVE MVP

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
  qrCode?: string;
  checkedIn?: boolean;
  checkInTime?: string;
  checkOutTime?: string;
}

export interface VisitRequest {
  ticketNumber: string;
  empDetails: Employee;
  visitorCategory: string;
  visitorCategoryOther?: string;
  numberOfGuests: number;
  guests: Guest[];
  purposeOfVisit: string;
  tentativeArrival: string;
  tentativeDuration: string;
  lunchRequired: boolean;
  lunchCategory?: string;
  dietaryRequirements?: string;
  meetingWith: string;
  typeOfLocation: 'Office' | 'Plant';
  locationToVisit: string;
  areaToVisit: string;
  cellLineVisit: boolean;
  anythingElse?: string;
  attachments?: string[];
  creationDatetime: string;
  status: 'pending' | 'approved' | 'declined';
  approvals: Approval[];
  currentApproverIndex: number;
}

export interface Approval {
  approverId: string;
  approverEmail: string;
  status: 'pending' | 'approved' | 'declined';
  timestamp?: string;
  reason?: string;
  allottedPerson?: string;
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

const STORAGE_KEYS = {
  EMPLOYEES: 'wave_employees',
  REQUESTS: 'wave_requests',
  HISTORY: 'wave_history',
  CURRENT_USER: 'wave_current_user',
  OTP: 'wave_otp',
};

// Initialize default employees
export const initializeDefaultData = () => {
  const employees = getEmployees();
  if (employees.length === 0) {
    const defaultEmployees: Employee[] = [
      {
        empid: 'PEPPL0874',
        empemail: 'aarnav.singh@premierenergies.com',
        empname: 'Aarnav Singh',
        dept: 'IT',
        subdept: 'IT',
        emplocation: 'Corporate Office',
        designation: 'Senior Executive',
        activeflag: 1,
        managerid: 'PSS1431',
      },
      {
        empid: 'PSS1431',
        empemail: 'ramesh.t@premierenergies.com',
        empname: 'Tangirala Ramesh',
        dept: 'IT',
        subdept: 'IT',
        emplocation: 'Corporate Office',
        designation: 'General Manager - Systems & Infrastructure',
        activeflag: 1,
        managerid: 'PSS1373',
      },
      {
        empid: 'PEPPL0548',
        empemail: 'chandra.kumar@premierenergies.com',
        empname: 'Chandra Mauli Kumar',
        dept: 'Production',
        subdept: 'Production',
        emplocation: 'Fabcity',
        designation: 'Chief Production Officer',
        activeflag: 1,
        managerid: '10000',
      },
      {
        empid: '10000',
        empemail: 'saluja@premierenergies.com',
        empname: 'Chiranjeev Singh',
        dept: 'Management',
        subdept: 'Management',
        emplocation: 'Corporate Office',
        designation: 'Managing Director',
        activeflag: 1,
        managerid: '10001',
      },
    ];
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(defaultEmployees));
  }
};

// Employee operations
export const getEmployees = (): Employee[] => {
  const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
  return data ? JSON.parse(data) : [];
};

export const getEmployeeByEmail = (email: string): Employee | null => {
  const employees = getEmployees();
  return employees.find(emp => emp.empemail === email) || null;
};

export const getEmployeeById = (empid: string): Employee | null => {
  const employees = getEmployees();
  return employees.find(emp => emp.empid === empid) || null;
};

// Request operations
export const getRequests = (): VisitRequest[] => {
  const data = localStorage.getItem(STORAGE_KEYS.REQUESTS);
  return data ? JSON.parse(data) : [];
};

export const getRequestByTicketNumber = (ticketNumber: string): VisitRequest | null => {
  const requests = getRequests();
  return requests.find(req => req.ticketNumber === ticketNumber) || null;
};

export const saveRequest = (request: VisitRequest) => {
  const requests = getRequests();
  const index = requests.findIndex(req => req.ticketNumber === request.ticketNumber);
  if (index >= 0) {
    requests[index] = request;
  } else {
    requests.push(request);
  }
  localStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(requests));
};

export const generateTicketNumber = (): string => {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const requests = getRequests();
  const todayRequests = requests.filter(req => req.ticketNumber.includes(date));
  const sequential = String(todayRequests.length + 1).padStart(3, '0');
  return `WAVE-${date}-${sequential}`;
};

// History operations
export const getHistory = (): HistoryEntry[] => {
  const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
  return data ? JSON.parse(data) : [];
};

export const getHistoryByTicketNumber = (ticketNumber: string): HistoryEntry[] => {
  const history = getHistory();
  return history.filter(entry => entry.ticketNumber === ticketNumber);
};

export const addHistoryEntry = (entry: HistoryEntry) => {
  const history = getHistory();
  history.push(entry);
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
};

// Current user operations
export const getCurrentUser = (): Employee | null => {
  const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  return data ? JSON.parse(data) : null;
};

export const setCurrentUser = (employee: Employee | null) => {
  if (employee) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(employee));
  } else {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
};

// OTP operations
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const saveOTP = (email: string, otp: string) => {
  const otpData = { email, otp, timestamp: Date.now() };
  localStorage.setItem(STORAGE_KEYS.OTP, JSON.stringify(otpData));
};

export const verifyOTP = (email: string, otp: string): boolean => {
  const data = localStorage.getItem(STORAGE_KEYS.OTP);
  if (!data) return false;
  const otpData = JSON.parse(data);
  // OTP valid for 10 minutes
  const isValid = otpData.email === email && 
                  otpData.otp === otp && 
                  (Date.now() - otpData.timestamp) < 600000;
  if (isValid) {
    localStorage.removeItem(STORAGE_KEYS.OTP);
  }
  return isValid;
};

// Generate QR code data for guest
export const generateQRCode = (ticketNumber: string, guestIndex: number): string => {
  return `WAVE-${ticketNumber}-GUEST-${guestIndex}`;
};
