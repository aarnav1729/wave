import { VisitRequest, Approval, Employee, getEmployeeById } from "./storage";

const CHANDRA_EMAIL = "chandra.kumar@premierenergies.com";
const CHANDRA_ID = "PEPPL0548";
const SALUJA_EMAIL = "saluja@premierenergies.com";
const SALUJA_ID = "10000";

const getTypeTokens = (typeOfLocation: string | undefined): string[] =>
  String(typeOfLocation || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

// Determine required approvers based on workflow rules
export const determineApprovers = (
  request: VisitRequest,
  empDetails: Employee
): Approval[] => {
  const approvals: Approval[] = [];

  const typeTokens = getTypeTokens(request.typeOfLocation);
  const hasPlant = typeTokens.includes("plant");

  // Rule 1: Reporting manager approval is always required.
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

  // Rule 2:
  // - Office only / Warehouse only / Office+Warehouse -> only manager.
  // - Any plant area included -> manager + Chandra.
  // - Any cell line included -> manager + both Chandra and Saluja
  //   (approval treated as "either one can approve" in detail page logic).
  const hasCellLine =
    !!request.cellLineVisit ||
    /\bcell\b/i.test(String(request.locationToVisit || ""));

  if (hasPlant) {
    approvals.push({
      approverId: CHANDRA_ID,
      approverEmail: CHANDRA_EMAIL,
      status: "pending",
    });

    if (hasCellLine) {
      approvals.push({
        approverId: SALUJA_ID,
        approverEmail: SALUJA_EMAIL,
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
  const email = String(userEmail || "").toLowerCase();
  return request.approvals.some(
    (approval) =>
      String(approval.approverEmail || "").toLowerCase() === email &&
      approval.status === "pending"
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
