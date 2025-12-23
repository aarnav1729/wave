import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  getRequestByTicketNumber,
  getCurrentUser,
  saveRequest,
  addHistoryEntry,
  getHistoryByTicketNumber,
  getEmployeeById,
} from "@/lib/storage";
import { isApprover, isFullyApproved } from "@/lib/workflow";
import {
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Users,
  History as HistoryIcon,
  Printer,
  ExternalLink,
  Share2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type GuestQRToolsProps = {
  value: string;
  label: string;
};

const GuestQRTools = ({ value, label }: GuestQRToolsProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const getSvgMarkup = () => {
    const svg = svgRef.current;
    if (!svg) return null;

    // Clone to avoid mutating the live DOM node
    const clone = svg.cloneNode(true) as SVGSVGElement;

    // Ensure proper XML namespace for standalone usage
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    // outerHTML usually works; fallback to XMLSerializer if needed
    return clone.outerHTML || new XMLSerializer().serializeToString(clone);
  };

  const openWindowWithContent = (
    title: string,
    bodyContent: string,
    extraHead: string = ""
  ) => {
    const win = window.open("", "_blank");
    if (!win) return;

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    ${extraHead}
  </head>
  <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f4f4f5;">
    ${bodyContent}
  </body>
</html>`);
    win.document.close();
  };

  const handleOpenInNewTab = () => {
    const svgMarkup = getSvgMarkup();
    if (!svgMarkup) return;

    // Inline the SVG directly in the new tab
    openWindowWithContent(label, svgMarkup);
  };

  const handlePrint = () => {
    const svgMarkup = getSvgMarkup();
    if (!svgMarkup) return;

    const printScript = `
      <script>
        window.onload = function() {
          window.focus();
          window.print();
        };
      </script>
    `;

    openWindowWithContent(`Print - ${label}`, svgMarkup, printScript);
  };

  const handleShare = async () => {
    const svgMarkup = getSvgMarkup();

    // Best case: Web Share with files
    if (svgMarkup && navigator.share && (navigator as any).canShare) {
      try {
        const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
        const file = new File([blob], "visitor-qr.svg", {
          type: "image/svg+xml",
        });

        if ((navigator as any).canShare({ files: [file] })) {
          await (navigator as any).share({
            title: `Visitor QR - ${label}`,
            text: `QR code for ${label}`,
            files: [file],
          });
          return;
        }
      } catch {
        // fall through
      }
    }

    // Fallback: share/copy the QR payload string
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Visitor QR - ${label}`,
          text: value,
        });
        return;
      } catch {
        // user cancelled or failed; ignore
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        alert(
          "QR data copied to clipboard (sharing not fully supported on this device)."
        );
        return;
      } catch {
        // ignore
      }
    }

    alert("Sharing is not supported on this device/browser.");
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white p-2 rounded">
        {/* This is still the on-screen QR */}
        <QRCodeSVG value={value} size={80} ref={svgRef} />
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={handleOpenInNewTab}
          title="Open QR in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={handlePrint}
          title="Print QR"
        >
          <Printer className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={handleShare}
          title="Share QR"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

const SWAVEDetail = () => {
  const { ticketNumber } = useParams<{ ticketNumber: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUser = getCurrentUser();
  const [request, setRequest] = useState(
    getRequestByTicketNumber(ticketNumber || "")
  );
  const [comment, setComment] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [allottedPerson, setAllottedPerson] = useState("");
  const history = getHistoryByTicketNumber(ticketNumber || "");

  // Local overrides approver can tweak before approve/decline
  const [lunchRequired, setLunchRequired] = useState(
    request?.lunchRequired ?? false
  );
  const [lunchCategory, setLunchCategory] = useState(
    request?.lunchCategory || ""
  );
  const [dietaryRequirements, setDietaryRequirements] = useState(
    request?.dietaryRequirements || ""
  );
  const [vehicleRequired, setVehicleRequired] = useState(
    (request as any)?.vehicleRequired ?? false
  );

  useEffect(() => {
    if (!request) {
      navigate("/overview");
    }
  }, [request, navigate]);

  // Keep local overrides in sync when request changes
  useEffect(() => {
    if (request) {
      setLunchRequired(request.lunchRequired ?? false);
      setLunchCategory(request.lunchCategory || "");
      setDietaryRequirements(request.dietaryRequirements || "");
      setVehicleRequired((request as any).vehicleRequired ?? false);
    }
  }, [request]);

  if (!request || !currentUser) return null;

  const canApprove = isApprover(request, currentUser.empemail);
  const fullyApproved = isFullyApproved(request);

  // Check if current user is final approver for plant visit
  const isFinalPlantApprover =
    request.typeOfLocation === "Plant" &&
    (currentUser.empemail === "chandra.kumar@premierenergies.com" ||
      currentUser.empemail === "saluja@premierenergies.com") &&
    canApprove;

  const handleApprove = () => {
    if (!request) return;

    // Build a list of changes made by the approver
    const changes: string[] = [];
    const boolLabel = (v: boolean | undefined) => (v ? "Yes" : "No");

    const oldLunchRequired = request.lunchRequired ?? false;
    const oldLunchCategory = request.lunchCategory || "-";
    const oldDietary = request.dietaryRequirements || "None";
    const oldVehicleRequired = (request as any).vehicleRequired ?? false;

    const newLunchRequired = lunchRequired;
    const newLunchCategoryDisplay = newLunchRequired
      ? lunchCategory || "-"
      : "-";
    const newDietaryDisplay = newLunchRequired
      ? dietaryRequirements || "None"
      : "None";
    const newVehicleRequired = vehicleRequired;

    if (oldLunchRequired !== newLunchRequired) {
      changes.push(
        `Lunch Required: ${boolLabel(oldLunchRequired)} → ${boolLabel(
          newLunchRequired
        )}`
      );
    }

    if (oldLunchCategory !== newLunchCategoryDisplay) {
      changes.push(
        `Lunch Category: ${oldLunchCategory} → ${newLunchCategoryDisplay}`
      );
    }

    if (oldDietary !== newDietaryDisplay) {
      changes.push(
        `Dietary Requirements: ${oldDietary} → ${newDietaryDisplay}`
      );
    }

    if (oldVehicleRequired !== newVehicleRequired) {
      changes.push(
        `Vehicle Required: ${boolLabel(oldVehicleRequired)} → ${boolLabel(
          newVehicleRequired
        )}`
      );
    }

    // Allotted person (only relevant for final plant approver)
    const previousApprovalForUser = request.approvals.find(
      (a) => a.approverEmail === currentUser.empemail
    );
    const oldAllottedPerson = previousApprovalForUser?.allottedPerson || "";
    const newAllottedPerson =
      isFinalPlantApprover && allottedPerson
        ? allottedPerson
        : oldAllottedPerson;

    if (oldAllottedPerson !== newAllottedPerson && newAllottedPerson) {
      changes.push(
        `Allotted Person: ${oldAllottedPerson || "-"} → ${newAllottedPerson}`
      );
    }

    const updatedApprovals = request.approvals.map((approval) =>
      approval.approverEmail === currentUser.empemail
        ? {
            ...approval,
            status: "approved" as const,
            timestamp: new Date().toISOString(),
            ...(isFinalPlantApprover && allottedPerson
              ? { allottedPerson }
              : {}),
          }
        : approval
    );

    const allApproved = updatedApprovals.every((a) => a.status === "approved");

    const updatedRequest = {
      ...request,
      // approver overrides:
      lunchRequired: newLunchRequired,
      lunchCategory: newLunchRequired ? lunchCategory : undefined,
      dietaryRequirements: newLunchRequired ? dietaryRequirements : undefined,
      vehicleRequired: newVehicleRequired,
      approvals: updatedApprovals,
      status: allApproved ? ("approved" as const) : ("pending" as const),
    };

    saveRequest(updatedRequest);
    setRequest(updatedRequest);

    const baseComment = (comment || "Request approved").trim();
    const changesSummary =
      changes.length > 0 ? ` | Changes: ${changes.join("; ")}` : "";
    const finalComment = `${baseComment}${changesSummary}`;

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: finalComment,
      actionType: "APPROVE",
      beforeState: "pending",
      afterState: allApproved ? "approved" : "pending_next_approval",
      timestamp: new Date().toISOString(),
    });

    toast({
      title: "Request Approved",
      description: allApproved
        ? "All approvals completed!"
        : "Waiting for next approval",
    });

    setComment("");
    setAllottedPerson("");
  };

  const handleDecline = () => {
    if (!declineReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for declining",
        variant: "destructive",
      });
      return;
    }

    const updatedApprovals = request.approvals.map((approval) =>
      approval.approverEmail === currentUser.empemail
        ? {
            ...approval,
            status: "declined" as const,
            timestamp: new Date().toISOString(),
            reason: declineReason,
          }
        : approval
    );

    const updatedRequest = {
      ...request,
      approvals: updatedApprovals,
      status: "declined" as const,
    };

    saveRequest(updatedRequest);
    setRequest(updatedRequest);

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: `Request declined: ${declineReason}`,
      actionType: "DECLINE",
      beforeState: "pending",
      afterState: "declined",
      timestamp: new Date().toISOString(),
    });

    toast({
      title: "Request Declined",
      description: "The request has been declined",
      variant: "destructive",
    });

    setDeclineReason("");
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <Card className="border-none shadow-soft bg-gradient-primary text-primary-foreground">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="text-2xl font-mono">
                  {request.ticketNumber}
                </CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  Created on{" "}
                  {new Date(request.creationDatetime).toLocaleDateString(
                    "en-IN"
                  )}
                </CardDescription>
              </div>
              {request.status === "approved" && (
                <Badge className="bg-success text-success-foreground">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approved
                </Badge>
              )}
              {request.status === "declined" && (
                <Badge className="bg-destructive text-destructive-foreground">
                  <XCircle className="h-4 w-4 mr-1" />
                  Declined
                </Badge>
              )}
              {request.status === "pending" && (
                <Badge className="bg-warning text-warning-foreground">
                  <Clock className="h-4 w-4 mr-1" />
                  Pending Approval
                </Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Requester Info */}
            <Card>
              <CardHeader>
                <CardTitle>Requester Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p className="font-medium">{request.empDetails.empname}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Employee ID:</span>
                    <p className="font-medium">{request.empDetails.empid}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Department:</span>
                    <p className="font-medium">{request.empDetails.dept}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>
                    <p className="font-medium">
                      {request.empDetails.emplocation}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Visit Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Visit Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Visitor Category:
                    </span>
                    <p className="font-medium">{request.visitorCategory}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Purpose of Visit:
                    </span>
                    <p className="font-medium">{request.purposeOfVisit}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Location Type:
                      </span>
                      <p className="font-medium">{request.typeOfLocation}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Location:
                      </span>
                      <p className="font-medium">{request.locationToVisit}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Area to Visit:
                    </span>
                    <p className="font-medium">{request.areaToVisit}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Meeting With:
                      </span>
                      <p className="font-medium">{request.meetingWith}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Cell Line Visit:
                      </span>
                      <p className="font-medium">
                        {request.cellLineVisit ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Arrival:
                      </span>
                      <p className="font-medium">
                        {new Date(request.tentativeArrival).toLocaleString(
                          "en-IN"
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Duration:
                      </span>
                      <p className="font-medium">{request.tentativeDuration}</p>
                    </div>
                  </div>

                  {/* Lunch details – always visible */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Lunch Required:
                      </span>
                      <p className="font-medium">
                        {request.lunchRequired ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Lunch Category:
                      </span>
                      <p className="font-medium">
                        {request.lunchRequired && request.lunchCategory
                          ? request.lunchCategory
                          : "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Dietary Requirements:
                      </span>
                      <p className="font-medium">
                        {request.lunchRequired && request.dietaryRequirements
                          ? request.dietaryRequirements
                          : "None"}
                      </p>
                    </div>
                  </div>

                  {/* Vehicle details */}
                  {/* Vehicle details */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Vehicle Required:
                      </span>
                      <p className="font-medium">
                        {request.vehicleRequired ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Vehicle Number:
                      </span>
                      <p className="font-medium">
                        {(request as any).vehicleNumber || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">
                        Visitor Number Tag:
                      </span>
                      <p className="font-medium">
                        {(request as any).visitorTagNumber || "-"}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Guest Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Guests ({request.numberOfGuests})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {request.guests.map((guest, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{guest.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {guest.designation} at {guest.company}
                        </p>
                      </div>
                      {fullyApproved && guest.qrCode && (
                        <GuestQRTools
                          value={guest.qrCode}
                          label={`${guest.name || "Guest"} - ${
                            request.ticketNumber
                          }`}
                        />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Phone:</span>{" "}
                        {guest.number}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Email:</span>{" "}
                        {guest.email}
                      </div>
                    </div>
                    {guest.checkedIn && (
                      <div className="flex items-center gap-2 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        Checked in at{" "}
                        {new Date(guest.checkInTime!).toLocaleTimeString(
                          "en-IN"
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Approval Actions */}
            {canApprove && request.status === "pending" && (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle>Action Required</CardTitle>
                  <CardDescription>
                    You are the current approver
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isFinalPlantApprover && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Allot Person to Visit
                      </label>
                      <Textarea
                        placeholder="Enter name of person to allot to this visit"
                        value={allottedPerson}
                        onChange={(e) => setAllottedPerson(e.target.value)}
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                  )}

                  {/* Approver overrides for lunch & vehicle */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Update lunch & vehicle (optional)
                    </p>

                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="detail-lunch-required"
                          checked={lunchRequired}
                          onCheckedChange={setLunchRequired}
                        />
                        <span className="text-sm text-muted-foreground">
                          Lunch required for this visit
                        </span>
                      </div>
                    </div>

                    {lunchRequired && (
                      <>
                        <div className="space-y-1">
                          <label
                            htmlFor="detail-lunch-category"
                            className="text-xs font-medium"
                          >
                            Lunch category
                          </label>
                          <Select
                            value={lunchCategory}
                            onValueChange={setLunchCategory}
                          >
                            <SelectTrigger id="detail-lunch-category">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="A">Category A</SelectItem>
                              <SelectItem value="B">Category B</SelectItem>
                              <SelectItem value="C">Category C</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="detail-dietary-req"
                            className="text-xs font-medium"
                          >
                            Dietary requirements
                          </label>
                          <Input
                            id="detail-dietary-req"
                            value={dietaryRequirements}
                            onChange={(e) =>
                              setDietaryRequirements(e.target.value)
                            }
                            placeholder="Any special dietary needs"
                          />
                        </div>
                      </>
                    )}

                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="detail-vehicle-required"
                          checked={vehicleRequired}
                          onCheckedChange={setVehicleRequired}
                        />
                        <span className="text-sm text-muted-foreground">
                          Vehicle required for this visit
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      placeholder="Add a comment (optional)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleApprove} className="w-full">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve Request
                  </Button>
                  <Separator />
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Reason for declining *"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={handleDecline}
                    variant="destructive"
                    className="w-full"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Decline Request
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Approval Status */}
            <Card>
              <CardHeader>
                <CardTitle>Approval Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {request.approvals.map((approval, index) => {
                  const approver = getEmployeeById(approval.approverId);
                  return (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 border rounded-lg"
                    >
                      <div className="flex-shrink-0 mt-1">
                        {approval.status === "approved" && (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        )}
                        {approval.status === "declined" && (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                        {approval.status === "pending" && (
                          <Clock className="h-5 w-5 text-warning" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">
                          {approver?.empname}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {approver?.designation}
                        </p>
                        {approval.timestamp && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(approval.timestamp).toLocaleString(
                              "en-IN"
                            )}
                          </p>
                        )}
                        {approval.allottedPerson && (
                          <p className="text-xs text-primary mt-1 font-medium">
                            Allotted to: {approval.allottedPerson}
                          </p>
                        )}
                        {approval.reason && (
                          <p className="text-xs text-destructive mt-1">
                            {approval.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* History */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HistoryIcon className="h-5 w-5" />
                  History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {history.map((entry, index) => {
                    const actor = getEmployeeById(entry.userId);

                    return (
                      <div
                        key={index}
                        className="text-sm pb-3 border-b last:border-0 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-xs tracking-wide uppercase">
                            {entry.actionType}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {new Date(entry.timestamp).toLocaleString("en-IN")}
                          </p>
                        </div>

                        <p className="text-sm">
                          <span className="font-medium">
                            {actor?.empname || entry.userId}
                          </span>
                          {actor?.designation && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {actor.designation}
                            </span>
                          )}
                        </p>

                        {entry.comment && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {entry.comment}
                          </p>
                        )}

                        <p className="text-[11px] text-muted-foreground mt-1">
                          State:{" "}
                          <span className="font-medium">
                            {entry.beforeState}
                          </span>{" "}
                          →{" "}
                          <span className="font-medium">
                            {entry.afterState}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SWAVEDetail;
