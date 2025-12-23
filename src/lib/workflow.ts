import { VisitRequest, Approval, Employee, getEmployeeById } from "./storage";

// Determine required approvers based on workflow rules
export const determineApprovers = (
  request: VisitRequest,
  empDetails: Employee
): Approval[] => {
  const approvals: Approval[] = [];

  // ---- Helper: parse typeOfLocation into a set of normalized tokens ----
  const rawType = request.typeOfLocation || "";
  const typeTokens = rawType
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const hasPlant = typeTokens.includes("plant");
  // Warehouse / Office presence not needed for matrix, only Plant matters
  // const hasWarehouse = typeTokens.includes("warehouse");
  // const hasOffice = typeTokens.includes("office");

  // -------------------------------------------------------------------
  // Rule 1: Manager approval always required
  // -------------------------------------------------------------------
  if (empDetails.managerid) {
    const manager = getEmployeeById(empDetails.managerid);
    if (manager) {
      approvals.push({
        approverId: manager.empid,
        approverEmail: manager.empemail,
        status: "pending",
      });
    }
  }

  // -------------------------------------------------------------------
  // Rule 2 / 3: Plant + cell-line logic (covers all your combinations)
  //
  // - If ANY Plant is selected:
  //    - cellLineVisit = false  -> RM + Chandra
  //    - cellLineVisit = true   -> RM + Saluja
  //
  // - If NO Plant selected (Office / Warehouse / both):
  //    -> only RM (no extra approver)
  // -------------------------------------------------------------------
  if (hasPlant) {
    if (request.cellLineVisit) {
      // Plant + Cell = Yes -> Saluja
      approvals.push({
        approverId: "10000",
        approverEmail: "saluja@premierenergies.com",
        status: "pending",
      });
    } else {
      // Plant + Cell = No -> Chandra
      approvals.push({
        approverId: "PEPPL0548",
        approverEmail: "chandra.kumar@premierenergies.com",
        status: "pending",
      });
    }
  }

  return approvals;
};

// Check if current user is an approver for the request
export const isApprover = (
  request: VisitRequest,
  userEmail: string
): boolean => {
  return request.approvals.some(
    (approval) =>
      approval.approverEmail === userEmail && approval.status === "pending"
  );
};

// Get current pending approver
export const getCurrentApprover = (request: VisitRequest): Approval | null => {
  const pendingApproval = request.approvals.find(
    (approval) => approval.status === "pending"
  );
  return pendingApproval || null;
};

// Check if all approvals are completed
export const isFullyApproved = (request: VisitRequest): boolean => {
  return (
    request.approvals.length > 0 &&
    request.approvals.every((approval) => approval.status === "approved")
  );
};

// Check if any approval is declined
export const isDeclined = (request: VisitRequest): boolean => {
  return request.approvals.some((approval) => approval.status === "declined");
};
