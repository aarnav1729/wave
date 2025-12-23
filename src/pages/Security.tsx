import { useState, useMemo, useRef } from "react";
import Layout from "@/components/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getRequests,
  saveRequest,
  addHistoryEntry,
  getCurrentUser,
} from "@/lib/storage";
import {
  Search,
  Scan,
  LogIn,
  LogOut,
  CheckCircle2,
  Camera,
  Printer,
  Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Parse "5", "5 hours", "5 Hrs" etc. into hours as number */
const parseDurationHours = (duration: string | undefined | null): number => {
  if (!duration) return 0;

  const direct = parseFloat(duration);
  if (!isNaN(direct)) return direct;

  const match = duration.match(/(\d+(\.\d+)?)/);
  if (match) return parseFloat(match[1]);

  return 0;
};

/** Compute expiry = firstCheckIn + duration + 24 hours */
const computeExpiry = (guest: any): Date | null => {
  if (!guest?.checkInTime) return null;
  const durationHours = parseDurationHours(guest.tentativeDuration);
  if (!durationHours || durationHours <= 0) return null;

  const firstCheckInMs = new Date(guest.checkInTime).getTime();
  const expiryMs = firstCheckInMs + (durationHours + 24) * 60 * 60 * 1000;
  return new Date(expiryMs);
};

/** Resize image client-side to keep base64 payload reasonable */
const resizeImageToDataUrl = (
  file: File,
  maxSize = 720,
  quality = 0.8
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        const w = img.width;
        const h = img.height;

        if (!w || !h) {
          return reject(new Error("Invalid image dimensions"));
        }

        const scale = Math.min(1, maxSize / Math.max(w, h));
        const nw = Math.round(w * scale);
        const nh = Math.round(h * scale);

        const canvas = document.createElement("canvas");
        canvas.width = nw;
        canvas.height = nh;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return reject(new Error("Canvas not supported"));
        }

        ctx.drawImage(img, 0, 0, nw, nh);

        // Try JPEG first (smaller), fallback to PNG
        try {
          const jpeg = canvas.toDataURL("image/jpeg", quality);
          resolve(jpeg);
        } catch {
          resolve(canvas.toDataURL("image/png"));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
};

/** Build a clean printable slip window */
const openPrintSlipWindow = (payload: {
  guest: any;
  request: any;
  visitorTagNumber?: string;
  expiry?: Date | null;
  securityEmpName?: string;
}) => {
  const { guest, request, visitorTagNumber, expiry, securityEmpName } = payload;

  const safe = (v: any) => (v == null ? "" : String(v));

  const arrivalStr = request?.tentativeArrival
    ? new Date(request.tentativeArrival).toLocaleString("en-IN")
    : "";

  const firstInStr = guest?.checkInTime
    ? new Date(guest.checkInTime).toLocaleString("en-IN")
    : "";

  const expiryStr = expiry ? expiry.toLocaleString("en-IN") : "";

  const photoHtml =
    guest?.picture && String(guest.picture).startsWith("data:image")
      ? `<div style="margin-top:10px;">
           <div style="font-size:11px; color:#555; margin-bottom:4px;">Gate photo</div>
           <img src="${guest.picture}" style="width:120px; height:auto; border:1px solid #ddd; border-radius:6px;" />
         </div>`
      : "";

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Visitor Slip - ${safe(guest?.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      padding: 14px;
      color: #0f172a;
    }
    .slip {
      width: 320px;
      border: 1px dashed #94a3b8;
      padding: 12px;
      border-radius: 10px;
    }
    .brand {
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 2px;
    }
    .sub {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 10px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 4px 0;
      font-size: 12px;
    }
    .label {
      color: #64748b;
      min-width: 110px;
    }
    .value {
      text-align: right;
      font-weight: 600;
      flex: 1;
      word-break: break-word;
    }
    .hr {
      height: 1px;
      background: #e2e8f0;
      margin: 10px 0;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
    }
    .foot {
      margin-top: 10px;
      font-size: 10px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="slip">
    <div class="brand">Premier Energies - Visitor Pass</div>
    <div class="sub">WAVE Gate Slip</div>

    <div class="row"><span class="label">Guest Name</span><span class="value">${safe(
      guest?.name
    )}</span></div>
    <div class="row"><span class="label">Company</span><span class="value">${safe(
      guest?.company
    )}</span></div>
    <div class="row"><span class="label">Designation</span><span class="value">${safe(
      guest?.designation
    )}</span></div>
    <div class="row"><span class="label">Phone</span><span class="value">${safe(
      guest?.number
    )}</span></div>
    <div class="row"><span class="label">Email</span><span class="value">${safe(
      guest?.email
    )}</span></div>

    <div class="hr"></div>

    <div class="row"><span class="label">Ticket</span><span class="value mono">${safe(
      request?.ticketNumber
    )}</span></div>
    <div class="row"><span class="label">Meeting With</span><span class="value">${safe(
      request?.meetingWith
    )}</span></div>
    <div class="row"><span class="label">Requested By</span><span class="value">${safe(
      request?.empDetails?.empname
    )}</span></div>
    <div class="row"><span class="label">Location</span><span class="value">${safe(
      request?.locationToVisit
    )}</span></div>
    <div class="row"><span class="label">Purpose</span><span class="value">${safe(
      request?.purposeOfVisit
    )}</span></div>

    <div class="hr"></div>

    <div class="row"><span class="label">Tentative Arrival</span><span class="value">${safe(
      arrivalStr
    )}</span></div>
    <div class="row"><span class="label">First Check-In</span><span class="value">${safe(
      firstInStr
    )}</span></div>
    <div class="row"><span class="label">Duration (hrs)</span><span class="value">${safe(
      request?.tentativeDuration
    )}</span></div>
    <div class="row"><span class="label">Valid Till</span><span class="value">${safe(
      expiryStr
    )}</span></div>

    ${
      visitorTagNumber
        ? `<div class="hr"></div>
           <div class="row"><span class="label">Visitor Tag</span><span class="value">${safe(
             visitorTagNumber
           )}</span></div>`
        : ""
    }

    ${photoHtml}

    <div class="foot">
      ${
        securityEmpName
          ? `Gate processed by: ${safe(securityEmpName)}<br/>`
          : ""
      }
      Please carry this slip during your visit.
    </div>
  </div>

  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>
`;

  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
};

const Security = () => {
  const [scanValue, setScanValue] = useState("");
  const [scannedGuest, setScannedGuest] = useState<any>(null);
  const [visitorTagInput, setVisitorTagInput] = useState("");
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const { toast } = useToast();
  const currentUser = getCurrentUser();
  const requests = getRequests();

  // For scanned guest card: pre-compute expiry info
  const scannedExpiry = scannedGuest ? computeExpiry(scannedGuest) : null;
  const scannedExpired = scannedExpiry
    ? new Date().getTime() > scannedExpiry.getTime()
    : false;

  // Get all approved requests with guests
  const approvedGuests = useMemo(() => {
    const guests: any[] = [];
    requests
      .filter((req) => req.status === "approved")
      .forEach((req) => {
        req.guests.forEach((guest, index) => {
          guests.push({
            ...guest,
            ticketNumber: req.ticketNumber,
            guestIndex: index,
            requester: req.empDetails?.empname,
            location: req.locationToVisit,
            arrivalDate: req.tentativeArrival,
            meetingWith: req.meetingWith,
            purposeOfVisit: req.purposeOfVisit,
            typeOfLocation: req.typeOfLocation,
            areaToVisit: req.areaToVisit,
            vehicleRequired: req.vehicleRequired,
            vehicleNumber: req.vehicleNumber,
            lunchRequired: req.lunchRequired,
            lunchCategory: req.lunchCategory,
            dietaryRequirements: req.dietaryRequirements,
            visitorTagNumber: req.visitorTagNumber,
            // ✅ add duration to each guest so Security can compute expiry
            tentativeDuration: req.tentativeDuration,
            // keep reference copy of empDetails for slip usage
            _empDetails: req.empDetails,
          });
        });
      });
    return guests;
  }, [requests]);

  const resetScanState = () => {
    setScanValue("");
    setScannedGuest(null);
    setVisitorTagInput("");
    setCapturedPhoto(null);
  };

  const handleScan = () => {
    if (!scanValue.trim()) {
      toast({
        title: "Invalid Scan",
        description: "Please enter or scan a QR code",
        variant: "destructive",
      });
      return;
    }

    // Find the guest by QR code
    const foundGuest = approvedGuests.find((g) => g.qrCode === scanValue);

    if (!foundGuest) {
      toast({
        title: "Guest Not Found",
        description: "No approved visitor found with this QR code",
        variant: "destructive",
      });
      setScannedGuest(null);
      setVisitorTagInput("");
      setCapturedPhoto(null);
      return;
    }

    setScannedGuest(foundGuest);
    setVisitorTagInput(foundGuest.visitorTagNumber || "");
    setCapturedPhoto(foundGuest.picture || null);
  };

  const handleTakePhotoClick = () => {
    photoInputRef.current?.click();
  };

  const handlePhotoSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const dataUrl = await resizeImageToDataUrl(file, 720, 0.8);
      setCapturedPhoto(dataUrl);

      toast({
        title: "Photo Captured",
        description: "Photo attached to this visitor for gate record.",
      });
    } catch (err: any) {
      console.error("[Security] photo capture error:", err);
      toast({
        title: "Photo Failed",
        description: err?.message || "Unable to capture photo",
        variant: "destructive",
      });
    }
  };

  const handlePrintSlip = (request: any, guest: any) => {
    const expiry = computeExpiry({
      ...guest,
      tentativeDuration: request?.tentativeDuration,
    });

    openPrintSlipWindow({
      guest,
      request,
      visitorTagNumber: visitorTagInput?.trim() || request?.visitorTagNumber,
      expiry,
      securityEmpName: currentUser?.empname,
    });
  };

  const handleCheckIn = () => {
    if (!scannedGuest || !currentUser) return;

    const request = getRequests().find(
      (r) => r.ticketNumber === scannedGuest.ticketNumber
    );
    if (!request) return;

    const now = new Date();
    const nowIso = now.toISOString();

    const existingGuest = request.guests[scannedGuest.guestIndex];
    const isFirstCheckIn = !existingGuest?.checkInTime;

    // --- Expiry logic: allow multiple in/out until
    // firstCheckInTime + duration + 24 hours
    const durationHours = parseDurationHours(request.tentativeDuration);
    if (existingGuest?.checkInTime && durationHours > 0) {
      const firstCheckInMs = new Date(existingGuest.checkInTime).getTime();
      const expiryMs = firstCheckInMs + (durationHours + 24) * 60 * 60 * 1000;

      if (now.getTime() > expiryMs) {
        toast({
          title: "QR Expired",
          description:
            "Visitor pass validity has expired. Please ask the requester to raise a new visit request.",
          variant: "destructive",
        });
        resetScanState();
        return;
      }
    }

    const updatedGuests = request.guests.map((g, idx) => {
      if (idx === scannedGuest.guestIndex) {
        return {
          ...g,
          checkedIn: true,
          checkInTime: g.checkInTime || nowIso,
          checkOutTime: null,
          // ✅ Gate photo attach (uses existing field)
          picture: capturedPhoto || g.picture || undefined,
        };
      }
      return g;
    });

    const cleanedTag = visitorTagInput?.trim() || undefined;

    const updatedRequest: any = {
      ...request,
      guests: updatedGuests,
      visitorTagNumber: cleanedTag || request.visitorTagNumber || undefined,
    };

    saveRequest(updatedRequest);

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: `Guest ${scannedGuest.name} checked in${
        cleanedTag ? ` with tag ${cleanedTag}` : ""
      }`,
      actionType: "CHECK_IN",
      beforeState: "not_checked_in",
      afterState: "checked_in",
      timestamp: nowIso,
    });

    toast({
      title: "Check-In Successful",
      description: `${scannedGuest.name} has been checked in`,
    });

    // ✅ Auto print only on first ever check-in
    try {
      if (isFirstCheckIn) {
        const refreshedReq =
          getRequests().find((r) => r.ticketNumber === request.ticketNumber) ||
          updatedRequest;

        const refreshedGuest =
          refreshedReq?.guests?.[scannedGuest.guestIndex] ||
          updatedGuests[scannedGuest.guestIndex];

        handlePrintSlip(refreshedReq, {
          ...refreshedGuest,
          tentativeDuration: refreshedReq?.tentativeDuration,
        });
      }
    } catch (e) {
      console.error("[Security] auto print failed:", e);
    }

    resetScanState();
  };

  const handleCheckOut = () => {
    if (!scannedGuest || !currentUser) return;

    if (!scannedGuest.checkInTime) {
      toast({
        title: "No Check-In Found",
        description: "Guest has no recorded check-in for this pass.",
        variant: "destructive",
      });
      return;
    }

    const request = getRequests().find(
      (r) => r.ticketNumber === scannedGuest.ticketNumber
    );
    if (!request) return;

    const checkOutTime = new Date().toISOString();

    const updatedGuests = request.guests.map((g, idx) => {
      if (idx === scannedGuest.guestIndex) {
        return {
          ...g,
          checkedIn: true,
          checkOutTime,
          // ✅ allow photo update on checkout too
          picture: capturedPhoto || g.picture || undefined,
        };
      }
      return g;
    });

    const cleanedTag = visitorTagInput?.trim() || undefined;

    const updatedRequest: any = {
      ...request,
      guests: updatedGuests,
      visitorTagNumber: cleanedTag || request.visitorTagNumber || undefined,
    };

    saveRequest(updatedRequest);

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: `Guest ${scannedGuest.name} checked out${
        cleanedTag ? ` (tag ${cleanedTag})` : ""
      }`,
      actionType: "CHECK_OUT",
      beforeState: "checked_in",
      afterState: "checked_out",
      timestamp: checkOutTime,
    });

    toast({
      title: "Check-Out Successful",
      description: `${scannedGuest.name} has been checked out`,
    });

    resetScanState();
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <Card className="border-none shadow-soft bg-gradient-primary text-primary-foreground">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Scan className="h-6 w-6" />
              Security Check-In/Out
            </CardTitle>
            <CardDescription className="text-primary-foreground/80">
              Scan visitor QR codes to manage entry, exit, gate photo and tag
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Hidden camera/file input */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoSelected}
          style={{ display: "none" }}
        />

        {/* Scanner Section */}
        <Card>
          <CardHeader>
            <CardTitle>QR Code Scanner</CardTitle>
            <CardDescription>
              Scan or enter the visitor&apos;s QR code
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Scan or enter QR code (e.g., WAVE-20250118-001-GUEST-1)"
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  className="pl-10"
                />
              </div>
              <Button onClick={handleScan} className="gap-2">
                <Scan className="h-4 w-4" />
                Scan
              </Button>
            </div>

            {scannedGuest && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-4 mt-2">
                    {/* Guest overview */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Name:</span>
                        <p className="font-semibold">{scannedGuest.name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Company:</span>
                        <p className="font-semibold">{scannedGuest.company}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ticket:</span>
                        <p className="font-mono text-xs">
                          {scannedGuest.ticketNumber}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Location:</span>
                        <p className="font-semibold">{scannedGuest.location}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Requested By:
                        </span>
                        <p className="font-semibold">
                          {scannedGuest.requester}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Meeting With:
                        </span>
                        <p className="font-semibold">
                          {scannedGuest.meetingWith || "—"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Status:</span>
                        <p>
                          {scannedGuest.checkedIn ? (
                            scannedGuest.checkOutTime ? (
                              <Badge className="bg-muted text-muted-foreground">
                                Checked Out
                              </Badge>
                            ) : (
                              <Badge className="bg-success text-success-foreground">
                                Checked In
                              </Badge>
                            )
                          ) : (
                            <Badge className="bg-warning text-warning-foreground">
                              Not Checked In
                            </Badge>
                          )}
                        </p>
                      </div>

                      {/* ✅ First Check-In + Pass Valid Till for security */}
                      {scannedGuest.checkInTime && (
                        <div>
                          <span className="text-muted-foreground">
                            First Check-In:
                          </span>
                          <p className="font-semibold">
                            {new Date(scannedGuest.checkInTime).toLocaleString(
                              "en-IN"
                            )}
                          </p>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">
                          Pass Valid Till:
                        </span>
                        <p className="font-semibold">
                          {scannedExpiry ? (
                            <span
                              className={
                                scannedExpired
                                  ? "text-destructive font-semibold"
                                  : "text-emerald-600 dark:text-emerald-400 font-semibold"
                              }
                            >
                              {scannedExpiry.toLocaleString("en-IN")}
                              {scannedExpired ? " (Expired)" : " (Active)"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                    </div>

                    {/* ✅ Visitor tag input */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          Visitor Tag Number
                        </label>
                        <Input
                          placeholder="Enter tag number (e.g., TAG-102)"
                          value={visitorTagInput}
                          onChange={(e) => setVisitorTagInput(e.target.value)}
                        />
                      </div>

                      {/* ✅ Photo capture + preview */}
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Camera className="h-3 w-3" />
                          Gate Photo
                        </label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleTakePhotoClick}
                            className="gap-2"
                          >
                            <Camera className="h-4 w-4" />
                            Take Photo
                          </Button>
                          {capturedPhoto && (
                            <span className="text-xs text-muted-foreground">
                              Ready to save
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Photo preview */}
                    {capturedPhoto && (
                      <div className="flex items-center gap-3">
                        <img
                          src={capturedPhoto}
                          alt="Gate capture"
                          className="h-20 w-20 object-cover rounded-md border"
                        />
                        <div className="text-xs text-muted-foreground">
                          This photo will be saved to the visitor record when
                          you check-in/out.
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      {/* Multiple cycles:
                          - Check In when currently outside
                          - Check Out when currently inside
                       */}
                      {(!scannedGuest.checkedIn ||
                        !!scannedGuest.checkOutTime) && (
                        <Button onClick={handleCheckIn} className="gap-2">
                          <LogIn className="h-4 w-4" />
                          Check In
                        </Button>
                      )}

                      {scannedGuest.checkedIn && !scannedGuest.checkOutTime && (
                        <Button onClick={handleCheckOut} className="gap-2">
                          <LogOut className="h-4 w-4" />
                          Check Out
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          const req = getRequests().find(
                            (r) => r.ticketNumber === scannedGuest.ticketNumber
                          );
                          if (!req) return;
                          const g = req.guests?.[scannedGuest.guestIndex];
                          if (!g) return;
                          handlePrintSlip(req, {
                            ...g,
                            tentativeDuration: req.tentativeDuration,
                          });
                        }}
                      >
                        <Printer className="h-4 w-4" />
                        Print Slip
                      </Button>

                      <Button onClick={resetScanState} variant="ghost">
                        Clear
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Guest List */}
        <Card>
          <CardHeader>
            <CardTitle>Approved Visitors</CardTitle>
            <CardDescription>
              {approvedGuests.length} visitors across all approved requests
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Arrival Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Check-In Time</TableHead>
                    <TableHead>Pass Valid Till</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedGuests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No approved visitors yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    approvedGuests.map((guest, idx) => {
                      const expiry = computeExpiry(guest);
                      const expired = expiry
                        ? new Date().getTime() > expiry.getTime()
                        : false;

                      return (
                        <TableRow key={`${guest.ticketNumber}-${idx}`}>
                          <TableCell className="font-medium">
                            {guest.name}
                          </TableCell>
                          <TableCell>{guest.company}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {guest.ticketNumber}
                          </TableCell>
                          <TableCell>{guest.location}</TableCell>
                          <TableCell>
                            {new Date(guest.arrivalDate).toLocaleDateString(
                              "en-IN"
                            )}
                          </TableCell>
                          <TableCell>
                            {guest.checkedIn ? (
                              guest.checkOutTime ? (
                                <Badge className="bg-muted text-muted-foreground">
                                  Checked Out
                                </Badge>
                              ) : (
                                <Badge className="bg-success text-success-foreground">
                                  Checked In
                                </Badge>
                              )
                            ) : (
                              <Badge className="bg-warning text-warning-foreground">
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {guest.checkInTime
                              ? new Date(guest.checkInTime).toLocaleString(
                                  "en-IN"
                                )
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {expiry ? (
                              <span
                                className={
                                  expired
                                    ? "text-destructive font-semibold"
                                    : "text-emerald-600 dark:text-emerald-400 font-semibold"
                                }
                              >
                                {expiry.toLocaleString("en-IN")}
                                {expired ? " (Expired)" : ""}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Security;
