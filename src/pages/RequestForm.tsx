import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  getCurrentUser,
  saveRequest,
  generateTicketNumber,
  getRequestByTicketNumber,
  addHistoryEntry,
  generateQRCode,
  type Guest,
  type VisitRequest,
} from "@/lib/storage";
import { determineApprovers } from "@/lib/workflow";

// Helper: convert ISO string (or DB date) → datetime-local value ("YYYY-MM-DDTHH:MM")
const toDateTimeLocal = (value?: string | null): string => {
  if (!value) return "";

  // If it's already in the correct format, reuse it
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n: number) => n.toString().padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Helper: normalize duration string → numeric hours string (e.g. "2.5")
const normalizeDurationHours = (value?: string | null): string => {
  if (!value) return "";
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
};

type LocationType = "Office" | "Plant" | "Warehouse";
type PlantSite = "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

type GuestError = {
  name: boolean;
  number: boolean;
  email: boolean;
  company: boolean;
  designation: boolean;
};

type FieldErrors = {
  purposeOfVisit: boolean;
  tentativeArrival: boolean;
  tentativeDuration: boolean;
  meetingWith: boolean;
  locationTypes: boolean;
  locationsSelected: boolean;
  areaToVisit: boolean;
  guests: GuestError[];
};

type Employee = {
  empid: string;
  empemail: string;
  empname: string;
  dept?: string | null;
  subdept?: string | null;
  emplocation?: string | null;
  designation?: string | null;
  activeflag?: number | null;
};

const OFFICE_LOCATIONS: string[] = [
  "Corporate Office",
  "City Office",
  "Delhi Office",
  "Pune Office",
];

const WAREHOUSE_LOCATIONS: string[] = [
  "Annaram",
  "Axonify",
  "Bahadurguda",
  "Narkhuda",
  "Kothur",
  "Radiant",
  "TGIIC",
  "HSTL",
];

const PLANT_SITES: PlantSite[] = ["P2", "P3", "P4", "P5", "P6", "P7"];

const PLANT_SUB_OPTIONS: Record<PlantSite, string[]> = {
  P2: [
    "Module (PEPPL)",
    "MonoPerc Cell (PEPPL)",
    "TopCon Cell (PEPPL)",
    "Other",
  ],
  P3: ["Cell (PEIPL)", "Other"],
  P4: ["Module (PEIPL)", "Other"],
  P5: ["Module (PEGEPL)", "Other"],
  P6: ["Module (PEGEPL)", "Other"],
  P7: ["Module (PEPPL)", "Other"],
};

const PLANT_OTHER_PLACEHOLDER =
  "Eg: Admin, Utility, Facility, Stores, IT, HR, etc.";

const AUTO_CELL_LINE_LOCATIONS: string[] = [
  "P2 - MonoPerc Cell (PEPPL)",
  "P2 - TopCon Cell (PEPPL)",
  "P3 - Cell (PEIPL)",
];

// We’ll treat any location that starts with one of these as a “Plant entry”
// so we can safely replace when user changes Plant dropdowns
const isPlantLocationEntry = (loc: string) => /^P[2-7]\b/.test(loc.trim());

const buildPlantLocationLabel = (
  site: PlantSite | "",
  sub: string,
  otherText: string
) => {
  if (!site || !sub) return "";

  if (sub === "Other") {
    const clean = (otherText || "").trim();
    if (!clean) return ""; // do not add incomplete "Other"
    return `${site} - ${clean}`;
  }

  return `${site} - ${sub}`;
};

const RequestForm = () => {
  const [searchParams] = useSearchParams();
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const hasEmployeeOptions = employeeOptions.length > 0;
  const editTicketNumber = searchParams.get("edit");
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUser = getCurrentUser();

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({
    purposeOfVisit: false,
    tentativeArrival: false,
    tentativeDuration: false,
    meetingWith: false,
    locationTypes: false,
    locationsSelected: false,
    areaToVisit: false,
    guests: [],
  });

  // Form state
  const [visitorCategory, setVisitorCategory] = useState("Employee");
  const [visitorCategoryOther, setVisitorCategoryOther] = useState("");
  const [numberOfGuests, setNumberOfGuests] = useState(1);
  const [guests, setGuests] = useState<Guest[]>([
    {
      name: "",
      number: "",
      email: "",
      company: "",
      designation: "",
      picture: "",
    },
  ]);

  const [guestAutoFilled, setGuestAutoFilled] = useState<boolean[]>([]);

  const [purposeOfVisit, setPurposeOfVisit] = useState("");
  const [tentativeArrival, setTentativeArrival] = useState("");
  const [tentativeDuration, setTentativeDuration] = useState("");
  const [lunchRequired, setLunchRequired] = useState(false);
  const [lunchCategory, setLunchCategory] = useState("");
  const [dietaryRequirements, setDietaryRequirements] = useState("");
  const [meetingWith, setMeetingWith] = useState("");

  // Type multi-select
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([
    "Office",
  ]);

  // Final flattened selected locations stored as strings
  const [locationsSelected, setLocationsSelected] = useState<string[]>([]);

  // Plant hierarchical state
  const [plantSite, setPlantSite] = useState<PlantSite | "">("");
  const [plantSubArea, setPlantSubArea] = useState<string>("");
  const [plantOtherText, setPlantOtherText] = useState<string>("");

  const [areaToVisit, setAreaToVisit] = useState("");
  const [cellLineVisit, setCellLineVisit] = useState(false);
  const [cellLineAutoSet, setCellLineAutoSet] = useState(false);
  const [cellLineOverridden, setCellLineOverridden] = useState(false);
  const [anythingElse, setAnythingElse] = useState("");
  const [vehicleRequired, setVehicleRequired] = useState(false);
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(30);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [visitorTagNumber, setVisitorTagNumber] = useState("");

  const plantSelected = locationTypes.includes("Plant");
  const officeSelected = locationTypes.includes("Office");
  const warehouseSelected = locationTypes.includes("Warehouse");

  // ------------------------- Edit mode hydrate -------------------------
  useEffect(() => {
    if (editTicketNumber) {
      const existingRequest = getRequestByTicketNumber(editTicketNumber);
      if (existingRequest) {
        setVisitorCategory(existingRequest.visitorCategory);
        setVisitorCategoryOther(existingRequest.visitorCategoryOther || "");
        setNumberOfGuests(existingRequest.numberOfGuests);
        setGuests(existingRequest.guests);
        setPurposeOfVisit(existingRequest.purposeOfVisit);
        setTentativeArrival(toDateTimeLocal(existingRequest.tentativeArrival));
        setTentativeDuration(
          normalizeDurationHours(existingRequest.tentativeDuration)
        );
        setLunchRequired(existingRequest.lunchRequired);
        setLunchCategory(existingRequest.lunchCategory || "");
        setDietaryRequirements(existingRequest.dietaryRequirements || "");
        setMeetingWith(existingRequest.meetingWith);

        // Parse comma-separated typeOfLocation -> multi-select
        const rawTypes = existingRequest.typeOfLocation || "Office";
        const parsedTypes = rawTypes
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean) as LocationType[];
        setLocationTypes(parsedTypes.length ? parsedTypes : ["Office"]);

        // Parse comma-separated locationToVisit -> array
        const rawLocs = existingRequest.locationToVisit || "";
        const parsedLocs = rawLocs
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        setLocationsSelected(parsedLocs);

        // Try best-effort parse for new Plant UI (if a matching entry exists)
        const plantEntry = parsedLocs.find((l) => isPlantLocationEntry(l));
        if (plantEntry) {
          const parts = plantEntry.split(" - ");
          const site = (parts[0] || "").trim() as PlantSite;
          const rest = parts.slice(1).join(" - ").trim();

          if (PLANT_SITES.includes(site)) {
            setPlantSite(site);

            const allowed = PLANT_SUB_OPTIONS[site];

            if (allowed.includes(rest)) {
              setPlantSubArea(rest);
              setPlantOtherText("");
            } else if (rest) {
              setPlantSubArea("Other");
              setPlantOtherText(rest);
            }
          }
        }

        setAreaToVisit(existingRequest.areaToVisit);
        setCellLineVisit(existingRequest.cellLineVisit);
        setAnythingElse(existingRequest.anythingElse || "");
        setVehicleRequired((existingRequest as any).vehicleRequired ?? false);
        setVehicleNumber((existingRequest as any).vehicleNumber || "");
        setVisitorTagNumber((existingRequest as any).visitorTagNumber || "");
      }
    }
  }, [editTicketNumber]);

  // ------------------------- Load employee names -------------------------
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const res = await fetch("/api/employees", {
          credentials: "include",
        });

        console.log("[RequestForm] /api/employees status:", res.status);

        if (!res.ok) {
          console.error(
            "[RequestForm] Failed to load employees:",
            await res.text()
          );
          return;
        }

        const json = await res.json();
        const data: Employee[] = json.data || json;

        const active = data.filter(
          (e) => e.activeflag === undefined || e.activeflag === 1
        );

        console.log("[RequestForm] employees loaded:", active.length);
        setEmployeeOptions(active);
      } catch (err) {
        console.error("[RequestForm] Failed to load employees:", err);
      }
    };

    loadEmployees();
  }, []);

  // ------------------------- Guests count sync -------------------------
  useEffect(() => {
    const diff = numberOfGuests - guests.length;

    if (diff > 0) {
      const newGuests = [
        ...guests,
        ...Array(diff).fill({
          name: "",
          number: "",
          email: "",
          company: "",
          designation: "",
          picture: "",
        }),
      ];
      setGuests(newGuests);

      setGuestAutoFilled((prev) => [...prev, ...Array(diff).fill(false)]);
    } else if (diff < 0) {
      setGuests(guests.slice(0, numberOfGuests));
      setGuestAutoFilled((prev) => prev.slice(0, numberOfGuests));
    }
  }, [numberOfGuests, guests]);

  const updateGuest = (index: number, field: keyof Guest, value: string) => {
    const newGuests = [...guests];
    newGuests[index] = { ...newGuests[index], [field]: value };
    setGuests(newGuests);
  };

  const handleGuestPictureFileChange = (index: number, file: File | null) => {
    if (!file) {
      updateGuest(index, "picture", "");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        updateGuest(index, "picture", result);
      }
    };
    reader.readAsDataURL(file);
  };

  // ------------------------- Vehicle dialog countdown -------------------------
  useEffect(() => {
    if (!vehicleDialogOpen) return;

    if (redirectSeconds <= 0) {
      window.open(
        "http://10.0.50.16:22443/create-vr",
        "_blank",
        "noopener,noreferrer"
      );
      setVehicleDialogOpen(false);
      return;
    }

    const timerId = window.setTimeout(() => {
      setRedirectSeconds((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [vehicleDialogOpen, redirectSeconds]);

  // ------------------------- Plant selection → sync into locationsSelected ---
  const plantLocationLabel = useMemo(() => {
    return buildPlantLocationLabel(plantSite, plantSubArea, plantOtherText);
  }, [plantSite, plantSubArea, plantOtherText]);

  useEffect(() => {
    // If Plant type not selected, ensure plant-derived values are cleared from selected list
    if (!plantSelected) {
      setLocationsSelected((prev) =>
        prev.filter((l) => !isPlantLocationEntry(l))
      );
      return;
    }

    setLocationsSelected((prev) => {
      const withoutPlant = prev.filter((l) => !isPlantLocationEntry(l));

      if (!plantLocationLabel) return withoutPlant;

      return Array.from(new Set([...withoutPlant, plantLocationLabel]));
    });
  }, [plantSelected, plantLocationLabel]);

  // Reset sub-area when site changes
  useEffect(() => {
    if (!plantSite) {
      setPlantSubArea("");
      setPlantOtherText("");
      return;
    }

    // If current sub-area not valid for this site, reset it
    const allowed = PLANT_SUB_OPTIONS[plantSite];
    if (!allowed.includes(plantSubArea)) {
      setPlantSubArea("");
      setPlantOtherText("");
    }
  }, [plantSite]);

  // ------------------------- Auto cell-line toggle updates -------------------
  useEffect(() => {
    const includesCellLineLocation = locationsSelected.some((loc) =>
      AUTO_CELL_LINE_LOCATIONS.includes(loc)
    );

    if (!includesCellLineLocation) {
      if (cellLineAutoSet) setCellLineAutoSet(false);
      if (cellLineOverridden) setCellLineOverridden(false);
      return;
    }

    if (plantSelected && !cellLineVisit && !cellLineOverridden) {
      setCellLineVisit(true);
      setCellLineAutoSet(true);
    }
  }, [locationsSelected, plantSelected, cellLineVisit, cellLineOverridden]);

  // ------------------------- Location toggles for Office/Warehouse ------------
  const toggleLocationType = (type: LocationType, checked: boolean) => {
    setLocationTypes((prev) => {
      if (checked) {
        const next = Array.from(new Set([...prev, type]));
        return next;
      } else {
        const next = prev.filter((t) => t !== type);
        if (next.length === 0) return prev;

        if (type === "Plant" && !next.includes("Plant")) {
          setCellLineVisit(false);
          setCellLineAutoSet(false);
          setCellLineOverridden(false);

          setPlantSite("");
          setPlantSubArea("");
          setPlantOtherText("");

          setLocationsSelected((locPrev) =>
            locPrev.filter((l) => !isPlantLocationEntry(l))
          );
        }

        return next;
      }
    });
  };

  const toggleLocation = (loc: string, checked: boolean) => {
    setLocationsSelected((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, loc]));
      }
      return prev.filter((l) => l !== loc);
    });
  };

  // ------------------------- Returning guest lookup ---------------------------
  const handleGuestNumberBlur = async (index: number, value: string) => {
    const digits = value.replace(/\D/g, "");

    if (!digits || digits.length < 10) {
      setGuestAutoFilled((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
      return;
    }

    try {
      const res = await fetch(
        `/api/guests/by-number/${encodeURIComponent(value)}`,
        { credentials: "include" }
      );

      if (!res.ok) {
        setGuestAutoFilled((prev) => {
          const next = [...prev];
          next[index] = false;
          return next;
        });

        if (res.status !== 404) {
          console.error(
            "[RequestForm] guest lookup failed:",
            res.status,
            await res.text()
          );
        }
        return;
      }

      const json = await res.json();
      const g = json.data || json;

      setGuests((prev) => {
        const next = [...prev];
        const existing = next[index] || {
          name: "",
          number: "",
          email: "",
          company: "",
          designation: "",
          picture: "",
        };

        next[index] = {
          ...existing,
          number: existing.number || value,
          name: g.name || existing.name,
          email: g.email || existing.email,
          company: g.company || existing.company,
          designation: g.designation || existing.designation,
          picture: g.picture || existing.picture,
        };

        return next;
      });

      setGuestAutoFilled((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });

      toast({
        title: "Returning guest detected",
        description:
          "We’ve auto-filled this guest’s details from their previous visit.",
      });
    } catch (err) {
      console.error("[RequestForm] guest lookup error:", err);
      setGuestAutoFilled((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
    }
  };

  // ------------------------- Submit -----------------------------------------
  const handleSubmit = () => {
    if (!currentUser) return;

    const durationNumber = parseFloat(tentativeDuration);

    const guestErrors: GuestError[] = guests.map((g) => ({
      name: !g.name.trim(),
      number: !g.number.trim(),
      email: false,
      company: !g.company.trim(),
      designation: !g.designation.trim(),
    }));

    const nextErrors: FieldErrors = {
      purposeOfVisit: !purposeOfVisit.trim(),
      tentativeArrival: !tentativeArrival,
      tentativeDuration:
        !tentativeDuration ||
        !Number.isFinite(durationNumber) ||
        durationNumber <= 0,
      meetingWith: !meetingWith.trim(),
      locationTypes: locationTypes.length === 0,
      locationsSelected: locationsSelected.length === 0,
      areaToVisit: false,
      guests: guestErrors,
    };

    const hasGuestErrors = guestErrors.some(
      (g) => g.name || g.number || g.company || g.designation
    );

    const hasTopLevelErrors =
      nextErrors.purposeOfVisit ||
      nextErrors.tentativeArrival ||
      nextErrors.tentativeDuration ||
      nextErrors.meetingWith ||
      nextErrors.locationTypes ||
      nextErrors.locationsSelected;

    if (hasGuestErrors || hasTopLevelErrors) {
      setFieldErrors(nextErrors);

      toast({
        title: "Missing / Invalid Fields",
        description:
          "Please correct the highlighted fields. Duration must be a positive number in hours, and at least one location type + location must be selected.",
        variant: "destructive",
      });

      return;
    }

    setFieldErrors({
      purposeOfVisit: false,
      tentativeArrival: false,
      tentativeDuration: false,
      meetingWith: false,
      locationTypes: false,
      locationsSelected: false,
      areaToVisit: false,
      guests: guests.map(() => ({
        name: false,
        number: false,
        email: false,
        company: false,
        designation: false,
      })),
    });

    const ticketNumber = editTicketNumber || generateTicketNumber();
    const isEdit = !!editTicketNumber;
    const existingRequest = isEdit
      ? getRequestByTicketNumber(ticketNumber)
      : null;

    const guestsWithQR = guests.map((guest, index) => ({
      ...guest,
      qrCode: guest.qrCode || generateQRCode(ticketNumber, index),
    }));

    const typeOfLocationJoined = locationTypes.join(",");
    const locationToVisitJoined = locationsSelected.join(", ");

    const request: VisitRequest = {
      ticketNumber,
      empDetails: currentUser,
      visitorCategory,
      visitorCategoryOther:
        visitorCategory === "Others" ? visitorCategoryOther : undefined,
      numberOfGuests,
      guests: guestsWithQR,
      purposeOfVisit,
      tentativeArrival,
      tentativeDuration,
      vehicleRequired,
      lunchRequired,
      lunchCategory: lunchRequired ? lunchCategory : undefined,
      dietaryRequirements: lunchRequired ? dietaryRequirements : undefined,
      meetingWith,
      typeOfLocation: typeOfLocationJoined,
      locationToVisit: locationToVisitJoined,
      areaToVisit,
      cellLineVisit,
      anythingElse,
      creationDatetime:
        existingRequest?.creationDatetime || new Date().toISOString(),
      status: isEdit ? "pending" : "pending",
      approvals: determineApprovers(
        {
          typeOfLocation: typeOfLocationJoined,
          cellLineVisit,
        } as VisitRequest,
        currentUser
      ),
      currentApproverIndex: 0,
    };

    const requestWithExtras: any = {
      ...request,
      vehicleNumber: vehicleNumber || undefined,
      visitorTagNumber: visitorTagNumber || undefined,
    };

    saveRequest(requestWithExtras);

    addHistoryEntry({
      ticketNumber,
      userId: currentUser.empid,
      comment: isEdit ? "Request edited and resubmitted" : "Request created",
      actionType: isEdit ? "EDIT" : "CREATE",
      beforeState: isEdit ? "approved/pending" : "none",
      afterState: "pending",
      timestamp: new Date().toISOString(),
    });

    toast({
      title: isEdit ? "Request Updated" : "Request Created",
      description: `Ticket ${ticketNumber} has been ${
        isEdit ? "updated" : "created"
      } successfully`,
    });

    navigate("/overview");
  };

  if (!currentUser) {
    navigate("/login");
    return null;
  }

  // ------------------------- UI ---------------------------------------------
  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              {editTicketNumber ? "Edit Visit Request" : "New Visit Request"}
            </CardTitle>
            <CardDescription>
              Fill in the details for your visitor request
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Employee Details (Auto-captured) */}
            <div className="space-y-4 p-4 bg-muted rounded-lg">
              <h3 className="font-semibold">
                Employee Details (Auto-captured)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  <span className="font-medium">{currentUser.empname}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">ID:</span>{" "}
                  <span className="font-medium">{currentUser.empid}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span className="font-medium">{currentUser.empemail}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Department:</span>{" "}
                  <span className="font-medium">{currentUser.dept}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Location:</span>{" "}
                  <span className="font-medium">{currentUser.emplocation}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Designation:</span>{" "}
                  <span className="font-medium">{currentUser.designation}</span>
                </div>
              </div>
            </div>

            {/* Visitor Category */}
            <div className="space-y-2">
              <Label htmlFor="visitorCategory">Visitor Category *</Label>
              <Select
                value={visitorCategory}
                onValueChange={setVisitorCategory}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Employee",
                    "Customer",
                    "Investor",
                    "Inspection",
                    "Auditor",
                    "Lender",
                    "Vendor",
                    "Others",
                  ].map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {visitorCategory === "Others" && (
                <Input
                  placeholder="Please specify"
                  value={visitorCategoryOther}
                  onChange={(e) => setVisitorCategoryOther(e.target.value)}
                />
              )}
            </div>

            {/* Number of Guests */}
            <div className="space-y-2">
              <Label htmlFor="numberOfGuests">Number of Guests *</Label>
              <Input
                id="numberOfGuests"
                type="number"
                min="1"
                max="20"
                value={numberOfGuests}
                onChange={(e) =>
                  setNumberOfGuests(parseInt(e.target.value) || 1)
                }
              />
            </div>

            {/* Guest Details */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Guest Details *</Label>
              </div>
              {guests.map((guest, index) => {
                const gError = fieldErrors.guests[index];

                const guestHasError =
                  gError &&
                  (gError.name ||
                    gError.number ||
                    gError.email ||
                    gError.company ||
                    gError.designation);

                return (
                  <Card
                    key={index}
                    className={`p-4 ${
                      guestHasError ? "border-destructive" : ""
                    }`}
                  >
                    <h4 className="font-medium mb-4">Guest {index + 1}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Phone first for auto-fill */}
                      <div className="space-y-2">
                        <Label>Phone Number *</Label>
                        <Input
                          value={guest.number}
                          onChange={(e) =>
                            updateGuest(index, "number", e.target.value)
                          }
                          onBlur={(e) =>
                            handleGuestNumberBlur(index, e.target.value)
                          }
                          placeholder="+91 XXXXXXXXXX"
                          className={
                            gError?.number
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                        {guestAutoFilled[index] && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            Returning guest detected. Details auto-filled from
                            previous visit.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Name *</Label>
                        <Input
                          value={guest.name}
                          onChange={(e) =>
                            updateGuest(index, "name", e.target.value)
                          }
                          placeholder="Full name"
                          className={
                            gError?.name
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={guest.email}
                          onChange={(e) =>
                            updateGuest(index, "email", e.target.value)
                          }
                          placeholder="email@company.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Company *</Label>
                        <Input
                          value={guest.company}
                          onChange={(e) =>
                            updateGuest(index, "company", e.target.value)
                          }
                          placeholder="Company name"
                          className={
                            gError?.company
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Designation *</Label>
                        <Input
                          value={guest.designation}
                          onChange={(e) =>
                            updateGuest(index, "designation", e.target.value)
                          }
                          placeholder="Job title"
                          className={
                            gError?.designation
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Picture (optional)</Label>
                        <div className="flex flex-col gap-2">
                          <Input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) =>
                              handleGuestPictureFileChange(
                                index,
                                e.target.files?.[0] || null
                              )
                            }
                          />

                          {guest.picture && (
                            <div className="mt-2">
                              <p className="text-xs text-muted-foreground mb-1">
                                Preview:
                              </p>
                              <img
                                src={guest.picture}
                                alt={`Guest ${index + 1} preview`}
                                className="h-24 w-24 object-cover rounded-md border"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Purpose */}
            <div className="space-y-2">
              <Label htmlFor="purposeOfVisit">Purpose of Visit *</Label>
              <Textarea
                id="purposeOfVisit"
                value={purposeOfVisit}
                onChange={(e) => setPurposeOfVisit(e.target.value)}
                placeholder="Describe the purpose of this visit"
                rows={3}
                className={
                  fieldErrors.purposeOfVisit
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
            </div>

            {/* Arrival + Duration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tentativeArrival">Tentative Arrival *</Label>
                <Input
                  id="tentativeArrival"
                  type="datetime-local"
                  value={tentativeArrival}
                  onChange={(e) => setTentativeArrival(e.target.value)}
                  className={
                    fieldErrors.tentativeArrival
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tentativeDuration">Duration (hours) *</Label>
                <Input
                  id="tentativeDuration"
                  type="number"
                  min="0.1"
                  step="0.25"
                  value={tentativeDuration}
                  onChange={(e) => setTentativeDuration(e.target.value)}
                  placeholder="e.g., 2.5"
                  className={
                    fieldErrors.tentativeDuration
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
              </div>
            </div>

            {/* Meeting With */}
            <div className="space-y-2">
              <Label htmlFor="meetingWith">Meeting With *</Label>

              <Input
                id="meetingWith"
                list={hasEmployeeOptions ? "meeting-with-employees" : undefined}
                value={meetingWith}
                onChange={(e) => setMeetingWith(e.target.value)}
                placeholder="Name of person(s) to meet"
                className={
                  fieldErrors.meetingWith
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />

              {hasEmployeeOptions && (
                <datalist id="meeting-with-employees">
                  {employeeOptions.map((emp) => {
                    const labelParts: string[] = [emp.empname];
                    if (emp.dept) labelParts.push(emp.dept);
                    if (emp.emplocation) labelParts.push(emp.emplocation);
                    const label = labelParts.join(" · ");

                    return (
                      <option key={emp.empid} value={emp.empname}>
                        {label}
                      </option>
                    );
                  })}
                </datalist>
              )}

              {!hasEmployeeOptions && (
                <p className="text-xs text-muted-foreground">
                  No employees loaded for autocomplete. Check if{" "}
                  <code>/api/employees</code> is reachable.
                </p>
              )}
            </div>

            {/* Lunch & Vehicle Requirements */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Lunch Required */}
                <div className="space-y-2">
                  <Label className="block" htmlFor="lunchRequired">
                    Lunch Required
                  </Label>
                  <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs ${
                            !lunchRequired
                              ? "font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          OFF
                        </span>
                        <Switch
                          id="lunchRequired"
                          checked={lunchRequired}
                          onCheckedChange={setLunchRequired}
                        />
                        <span
                          className={`text-xs ${
                            lunchRequired
                              ? "font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          ON
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Slide towards <span className="font-semibold">ON</span> if
                      lunch is needed for the guests.
                    </p>
                  </div>
                </div>

                {/* Vehicle Required */}
                <div className="space-y-2">
                  <Label className="block" htmlFor="vehicleRequired">
                    Vehicle Required?
                  </Label>
                  <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs ${
                            !vehicleRequired
                              ? "font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          OFF
                        </span>
                        <Switch
                          id="vehicleRequired"
                          checked={vehicleRequired}
                          onCheckedChange={(checked) => {
                            setVehicleRequired(checked);
                            if (checked) {
                              setRedirectSeconds(30);
                              setVehicleDialogOpen(true);
                            } else {
                              setVehicleDialogOpen(false);
                            }
                          }}
                        />
                        <span
                          className={`text-xs ${
                            vehicleRequired
                              ? "font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          ON
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Slide towards <span className="font-semibold">ON</span> to
                      request an official vehicle.
                    </p>
                  </div>
                </div>
              </div>

              {vehicleRequired && (
                <div className="space-y-2">
                  <Label htmlFor="vehicleNumber">
                    Vehicle Number (optional)
                  </Label>
                  <Input
                    id="vehicleNumber"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    placeholder="e.g., TS09AB1234"
                  />
                </div>
              )}

              {lunchRequired && (
                <>
                  <div className="space-y-2">
                    <Label>Lunch Category</Label>
                    <Select
                      value={lunchCategory}
                      onValueChange={setLunchCategory}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">Category A</SelectItem>
                        <SelectItem value="B">Category B</SelectItem>
                        <SelectItem value="C">Category C</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Dietary Requirements</Label>
                    <Input
                      value={dietaryRequirements}
                      onChange={(e) => setDietaryRequirements(e.target.value)}
                      placeholder="Any special dietary requirements"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Location Details */}
            <div className="space-y-4">
              {/* Type of Location - multi-select */}
              <div className="space-y-2">
                <Label>Type of Location *</Label>
                <div
                  className={`flex flex-wrap gap-4 rounded-md border px-3 py-3 ${
                    fieldErrors.locationTypes ? "border-destructive" : ""
                  }`}
                >
                  {(["Office", "Plant", "Warehouse"] as LocationType[]).map(
                    (type) => (
                      <label
                        key={type}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={locationTypes.includes(type)}
                          onCheckedChange={(checked) =>
                            toggleLocationType(type, Boolean(checked))
                          }
                        />
                        <span>{type}</span>
                      </label>
                    )
                  )}
                </div>
              </div>

              {/* Locations to Visit - split by type */}
              <div className="space-y-2">
                <Label>Location(s) to Visit *</Label>

                {/* Office */}
                {officeSelected && (
                  <div
                    className={`rounded-md border px-3 py-3 ${
                      fieldErrors.locationsSelected ? "border-destructive" : ""
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Office
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {OFFICE_LOCATIONS.map((loc) => (
                        <label
                          key={loc}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={locationsSelected.includes(loc)}
                            onCheckedChange={(checked) =>
                              toggleLocation(loc, Boolean(checked))
                            }
                          />
                          <span>{loc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warehouse */}
                {warehouseSelected && (
                  <div
                    className={`rounded-md border px-3 py-3 ${
                      fieldErrors.locationsSelected ? "border-destructive" : ""
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Warehouse
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {WAREHOUSE_LOCATIONS.map((loc) => (
                        <label
                          key={loc}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={locationsSelected.includes(loc)}
                            onCheckedChange={(checked) =>
                              toggleLocation(loc, Boolean(checked))
                            }
                          />
                          <span>{loc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plant hierarchy */}
                {plantSelected && (
                  <div
                    className={`rounded-md border px-3 py-3 space-y-3 ${
                      fieldErrors.locationsSelected ? "border-destructive" : ""
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      Plant
                    </p>

                    {/* Site dropdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Plant Site *</Label>
                        <Select
                          value={plantSite}
                          onValueChange={(v) => setPlantSite(v as PlantSite)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Plant (P2 - P7)" />
                          </SelectTrigger>
                          <SelectContent>
                            {PLANT_SITES.map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Sub-area dropdown */}
                      <div className="space-y-2">
                        <Label>Plant Area *</Label>
                        <Select
                          value={plantSubArea}
                          onValueChange={(v) => setPlantSubArea(v)}
                          disabled={!plantSite}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                plantSite
                                  ? "Select area"
                                  : "Select plant site first"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {(plantSite
                              ? PLANT_SUB_OPTIONS[plantSite]
                              : []
                            ).map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Other text input */}
                    {plantSite && plantSubArea === "Other" && (
                      <div className="space-y-2">
                        <Label>Specify Plant Area *</Label>
                        <Input
                          value={plantOtherText}
                          onChange={(e) => setPlantOtherText(e.target.value)}
                          placeholder={PLANT_OTHER_PLACEHOLDER}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          This will be stored as:{" "}
                          <span className="font-medium">
                            {plantSite} - {plantOtherText || "…"}
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Read-only preview */}
                    <div className="rounded-md bg-muted px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        Selected Plant Location:
                      </p>
                      <p className="text-sm font-medium">
                        {plantLocationLabel || "Not selected yet"}
                      </p>
                    </div>
                  </div>
                )}

                {!officeSelected && !warehouseSelected && !plantSelected && (
                  <p className="text-sm text-muted-foreground">
                    Select at least one Type of Location above to see options.
                  </p>
                )}
              </div>

              {/* Area to visit (optional) */}
              <div className="space-y-2">
                <Label htmlFor="areaToVisit">Area to Visit (optional)</Label>
                <Input
                  id="areaToVisit"
                  value={areaToVisit}
                  onChange={(e) => setAreaToVisit(e.target.value)}
                  placeholder="Specific area or department (optional)"
                />
              </div>

              {/* Cell line toggle */}
              {plantSelected && (
                <div className="space-y-2">
                  <Label className="block" htmlFor="cellLineVisit">
                    Cell line to be visited
                  </Label>
                  <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="cellLineVisit"
                          checked={cellLineVisit}
                          onCheckedChange={(checked) => {
                            setCellLineVisit(checked);
                            setCellLineAutoSet(false);
                            setCellLineOverridden(true);
                          }}
                        />
                        <span className="text-sm text-muted-foreground">
                          Toggle on if guests will enter any cell line area
                        </span>
                      </div>
                    </div>

                    {cellLineAutoSet && (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Based on the selected plant location, we&rsquo;ve
                        automatically turned this{" "}
                        <span className="font-semibold">ON</span>. Turn it OFF
                        if guests will{" "}
                        <span className="font-semibold">not</span> enter the
                        actual cell production line.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Visitor Tag */}
            <div className="space-y-2">
              <Label htmlFor="visitorTagNumber">
                Visitor Number Tag (optional)
              </Label>
              <Input
                id="visitorTagNumber"
                value={visitorTagNumber}
                onChange={(e) => setVisitorTagNumber(e.target.value)}
                placeholder="Tag / badge number if already assigned"
              />
            </div>

            {/* Anything else */}
            <div className="space-y-2">
              <Label htmlFor="anythingElse">
                Anything else we should know?
              </Label>
              <Textarea
                id="anythingElse"
                value={anythingElse}
                onChange={(e) => setAnythingElse(e.target.value)}
                placeholder="Any additional information"
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button onClick={handleSubmit} size="lg" className="flex-1">
                {editTicketNumber ? "Update Request" : "Submit Request"}
              </Button>
              <Button
                onClick={() => navigate("/overview")}
                variant="outline"
                size="lg"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle Dialog */}
      <Dialog
        open={vehicleDialogOpen}
        onOpenChange={(open) => {
          setVehicleDialogOpen(open);
          if (!open) {
            setVehicleRequired(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vehicle Request Required</DialogTitle>
            <DialogDescription>
              To request a vehicle please create a vehicle request at{" "}
              <a
                href="http://10.0.50.16:22443/create-vr"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                http://10.0.50.16:22443/create-vr
              </a>
              , a new tab will open redirecting you to this url in{" "}
              <span className="font-semibold">
                {redirectSeconds} second{redirectSeconds !== 1 ? "s" : ""}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-2">
            <div className="rounded-md border px-4 py-3 bg-muted">
              <p className="text-sm text-muted-foreground">
                Please keep this page open. We will automatically open the
                vehicle request page in a new tab after the countdown finishes.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setVehicleDialogOpen(false);
                setVehicleRequired(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                window.open(
                  "http://10.0.50.16:22443/create-vr",
                  "_blank",
                  "noopener,noreferrer"
                );
                setVehicleDialogOpen(false);
              }}
            >
              Open now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default RequestForm;
