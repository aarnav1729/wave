// server.cjs
"use strict";

const path = require("path");
const fs = require("fs");
const https = require("https");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const sql = require("mssql");

// === WhatsApp Web client import ============================================
const {
  sendWhatsAppText,
  sendWhatsAppTextWithQr,
} = require("./whatsappClient.cjs");

// HTTPS port + host (same port for FE + BE)
const PORT = Number(process.env.PORT) || 24443;
const HOST = process.env.HOST || "0.0.0.0";

// EXACT dbConfig AS PROVIDED BY YOU
const dbConfig = {
  user: "PEL_DB",
  password: "Pel@0184",
  server: "10.0.50.17",
  port: 1433,
  database: "wave",
  // --- timeouts (ms) ---
  // 0 = no timeout (let it run as long as it needs)
  requestTimeout: 100000,
  connectionTimeout: 10000000,
  // optional: adjust pool idles if helpful
  pool: {
    idleTimeoutMillis: 300000,
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// MSSQL Pool + DB Init (create tables, seed employees)
let poolPromise;

/**
 * Get or create global MSSQL pool.
 */
async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig);
  }
  return poolPromise;
}

// ---------------------------------------------------------------------------
// Plant config (mirrors frontend rules)
// ---------------------------------------------------------------------------

const PLANT_SITES = ["P2", "P3", "P4", "P5", "P6", "P7"];

const PLANT_SUB_OPTIONS = {
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

const isPlantLocationEntry = (loc) =>
  /^P[2-7]\b/.test(String(loc || "").trim());

/**
 * Extract plantSite/plantArea/plantAreaOther from locationToVisit
 * The frontend currently stores Plant choice as:
 *   "P2 - Module (PEPPL)"
 *   "P2 - Admin"
 * We interpret unknown values as "Other" + store text in plantAreaOther.
 */
function derivePlantFieldsFromLocation(locationToVisit) {
  const out = {
    plantSite: null,
    plantArea: null,
    plantAreaOther: null,
  };

  if (!locationToVisit || typeof locationToVisit !== "string") return out;

  const parts = locationToVisit
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const plantEntry = parts.find((p) => isPlantLocationEntry(p));
  if (!plantEntry) return out;

  const split = plantEntry.split(" - ");
  const site = (split[0] || "").trim();
  const areaText = split.slice(1).join(" - ").trim();

  if (!PLANT_SITES.includes(site)) return out;

  out.plantSite = site;

  if (!areaText) {
    out.plantArea = null;
    out.plantAreaOther = null;
    return out;
  }

  const allowed = PLANT_SUB_OPTIONS[site] || [];

  // If matches allowed option and is not literal "Other"
  if (allowed.includes(areaText) && areaText !== "Other") {
    out.plantArea = areaText;
    out.plantAreaOther = null;
    return out;
  }

  // Otherwise treat as Other
  out.plantArea = "Other";
  out.plantAreaOther = areaText;

  return out;
}

/**
 * T-SQL to create tables IF NOT EXISTS.
 * This covers:
 * - Employees
 * - VisitRequests
 * - Guests
 * - Approvals
 * - HistoryEntries
 */
const INIT_TABLES_SQL = `
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Employees')
BEGIN
  CREATE TABLE Employees (
    empid         NVARCHAR(50)   NOT NULL PRIMARY KEY,
    empemail      NVARCHAR(255)  NOT NULL UNIQUE,
    empname       NVARCHAR(255)  NOT NULL,
    dept          NVARCHAR(100)  NULL,
    subdept       NVARCHAR(100)  NULL,
    emplocation   NVARCHAR(100)  NULL,
    designation   NVARCHAR(100)  NULL,
    activeflag    INT            NOT NULL DEFAULT(1),
    managerid     NVARCHAR(50)   NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VisitRequests')
BEGIN
  CREATE TABLE VisitRequests (
    ticketNumber         NVARCHAR(50)  NOT NULL PRIMARY KEY,
    empid                NVARCHAR(50)  NOT NULL,
    visitorCategory      NVARCHAR(100) NOT NULL,
    visitorCategoryOther NVARCHAR(255) NULL,
    numberOfGuests       INT           NOT NULL,
    purposeOfVisit       NVARCHAR(MAX) NOT NULL,
    tentativeArrival     DATETIME2     NOT NULL,
    tentativeDuration    NVARCHAR(100) NOT NULL,
    vehicleRequired      BIT           NOT NULL DEFAULT(0),
    lunchRequired        BIT           NOT NULL DEFAULT(0),
    lunchCategory        NVARCHAR(100) NULL,
    dietaryRequirements  NVARCHAR(255) NULL,
    meetingWith          NVARCHAR(255) NOT NULL,

    -- Updated sizing for multi-select + longer values
    typeOfLocation       NVARCHAR(100) NOT NULL,
    locationToVisit      NVARCHAR(1000) NOT NULL,

    areaToVisit          NVARCHAR(255) NOT NULL,
    cellLineVisit        BIT           NOT NULL DEFAULT(0),
    anythingElse         NVARCHAR(MAX) NULL,
    attachments          NVARCHAR(MAX) NULL, -- JSON string if used
    creationDatetime     DATETIME2     NOT NULL,
    status               NVARCHAR(20)  NOT NULL, -- 'pending' | 'approved' | 'declined'
    currentApproverIndex INT           NOT NULL DEFAULT(0),
    vehicleNumber        NVARCHAR(100) NULL,
    visitorTagNumber     NVARCHAR(100) NULL,

    -- ✅ New Plant hierarchy fields
    plantSite            NVARCHAR(10)  NULL,
    plantArea            NVARCHAR(255) NULL,
    plantAreaOther       NVARCHAR(255) NULL,

    CONSTRAINT FK_VisitRequests_Employees
      FOREIGN KEY (empid) REFERENCES Employees(empid)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Guests')
BEGIN
  CREATE TABLE Guests (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ticketNumber  NVARCHAR(50) NOT NULL,
    guestIndex    INT          NOT NULL,
    name          NVARCHAR(255) NOT NULL,
    number        NVARCHAR(50)  NOT NULL,
    email         NVARCHAR(255) NOT NULL,
    company       NVARCHAR(255) NOT NULL,
    designation   NVARCHAR(255) NOT NULL,
    qrCode        NVARCHAR(255) NULL,
    checkedIn     BIT          NOT NULL DEFAULT(0),
    checkInTime   DATETIME2    NULL,
    checkOutTime  DATETIME2    NULL,
    picture       NVARCHAR(MAX) NULL,

    CONSTRAINT FK_Guests_VisitRequests
      FOREIGN KEY (ticketNumber) REFERENCES VisitRequests(ticketNumber)
  );
END;

-- Ensure picture column exists on existing DBs
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'picture'
    AND Object_ID = Object_ID('Guests')
)
BEGIN
  ALTER TABLE Guests ADD picture NVARCHAR(MAX) NULL;
END;

-- Ensure vehicleRequired column exists on existing VisitRequests tables
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'vehicleRequired'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD vehicleRequired BIT NOT NULL DEFAULT(0);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'vehicleNumber'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD vehicleNumber NVARCHAR(100) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'visitorTagNumber'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD visitorTagNumber NVARCHAR(100) NULL;
END;

-- ✅ Ensure new Plant hierarchy columns exist on existing DBs
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'plantSite'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD plantSite NVARCHAR(10) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'plantArea'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD plantArea NVARCHAR(255) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'plantAreaOther'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ADD plantAreaOther NVARCHAR(255) NULL;
END;

-- ✅ Expand typeOfLocation size safely
IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'typeOfLocation'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ALTER COLUMN typeOfLocation NVARCHAR(100) NOT NULL;
END;

-- ✅ Expand locationToVisit size safely
IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE Name = 'locationToVisit'
    AND Object_ID = Object_ID('VisitRequests')
)
BEGIN
  ALTER TABLE VisitRequests ALTER COLUMN locationToVisit NVARCHAR(1000) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Approvals')
BEGIN
  CREATE TABLE Approvals (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    ticketNumber   NVARCHAR(50) NOT NULL,
    approverId     NVARCHAR(50) NOT NULL,
    approverEmail  NVARCHAR(255) NOT NULL,
    status         NVARCHAR(20) NOT NULL, -- 'pending' | 'approved' | 'declined'
    [timestamp]    DATETIME2    NULL,
    reason         NVARCHAR(MAX) NULL,
    allottedPerson NVARCHAR(255) NULL,

    CONSTRAINT FK_Approvals_VisitRequests
      FOREIGN KEY (ticketNumber) REFERENCES VisitRequests(ticketNumber)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HistoryEntries')
BEGIN
  CREATE TABLE HistoryEntries (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ticketNumber NVARCHAR(50) NOT NULL,
    userId     NVARCHAR(50) NOT NULL,
    comment    NVARCHAR(MAX) NOT NULL,
    actionType NVARCHAR(50) NOT NULL,
    beforeState NVARCHAR(50) NOT NULL,
    afterState NVARCHAR(50) NOT NULL,
    [timestamp] DATETIME2 NOT NULL,

    CONSTRAINT FK_HistoryEntries_VisitRequests
      FOREIGN KEY (ticketNumber) REFERENCES VisitRequests(ticketNumber)
  );
END;
`;

/**
 * Seed default employees matching initializeDefaultData()
 */
async function seedDefaultEmployees() {
  const pool = await getPool();
  const request = pool.request();

  const MERGE_SQL = `
MERGE Employees AS target
USING (VALUES
  ('PEPPL0874', 'aarnav.singh@premierenergies.com', 'Aarnav Singh',       'IT',          'IT',          'Corporate Office', 'Senior Executive',              1, 'PSS1431'),
  ('PSS1431',   'ramesh.t@premierenergies.com',     'Tangirala Ramesh',   'IT',          'IT',          'Corporate Office', 'General Manager - Systems & Infrastructure', 1, 'PSS1373'),
  ('PEPPL0548', 'chandra.kumar@premierenergies.com','Chandra Mauli Kumar','Production',  'Production',  'Fabcity',          'Chief Production Officer',      1, '10000'),
  ('10000',     'saluja@premierenergies.com',       'Chiranjeev Singh',   'Management',  'Management',  'Corporate Office', 'Managing Director',             1, '10001'),
  ('PEL1729',   'security@premierenergies.com',     'Security Manager',   'Security', 'Security', 'Fabcity',          'Security Manager',                            1, 'PEPPL0874')
) AS source (empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid)
ON target.empid = source.empid
WHEN NOT MATCHED BY TARGET THEN
  INSERT (empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid)
  VALUES (source.empid, source.empemail, source.empname, source.dept, source.subdept, source.emplocation, source.designation, source.activeflag, source.managerid);
`;

  await request.query(MERGE_SQL);
}

/**
 * Run DB init: create tables + seed data.
 */
async function initDb() {
  const pool = await getPool();
  await pool.request().batch(INIT_TABLES_SQL);
  await seedDefaultEmployees();
  console.log("[DB] Tables ensured and default employees seeded.");
}

// ----------------------------------------------------------------------------
// Express App Setup
// ----------------------------------------------------------------------------

const app = express();

// Security / perf middlewares
app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
app.use(compression());
app.use(morgan("combined"));

// ----------------------------------------------------------------------------
// API Helpers
// ----------------------------------------------------------------------------

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Helper that converts nullable Date to ISO string (or null).
 */
function toIsoOrNull(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// API Routes
// ----------------------------------------------------------------------------

// Health checks
app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().query("SELECT 1 AS ok");
      res.json({ status: "ok", db: "up" });
    } catch (err) {
      console.error("[Health] DB check failed:", err.message);
      res.status(500).json({ status: "error", db: "down" });
    }
  })
);

// ------------------------- Employees -------------------------

app.get(
  "/api/employees",
  asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool
      .request()
      .query(
        "SELECT empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid FROM Employees"
      );
    res.json({ data: result.recordset });
  })
);

app.get(
  "/api/employees/email/:email",
  asyncHandler(async (req, res) => {
    const { email } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar(255), email)
      .query(
        "SELECT TOP 1 empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid FROM Employees WHERE empemail = @email"
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json({ data: result.recordset[0] });
  })
);

app.get(
  "/api/employees/id/:empid",
  asyncHandler(async (req, res) => {
    const { empid } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("empid", sql.NVarChar(50), empid)
      .query(
        "SELECT TOP 1 empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid FROM Employees WHERE empid = @empid"
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json({ data: result.recordset[0] });
  })
);

// ------------------------- Visit Requests -------------------------

async function fetchHydratedRequests(filterTicketNumber = null) {
  const pool = await getPool();

  const request = pool.request();
  let requestsSql = `
    SELECT
      vr.ticketNumber,
      vr.empid,
      vr.visitorCategory,
      vr.visitorCategoryOther,
      vr.numberOfGuests,
      vr.purposeOfVisit,
      vr.tentativeArrival,
      vr.tentativeDuration,
      vr.vehicleRequired,
      vr.lunchRequired,
      vr.lunchCategory,
      vr.dietaryRequirements,
      vr.meetingWith,
      vr.typeOfLocation,
      vr.locationToVisit,
      vr.areaToVisit,
      vr.cellLineVisit,
      vr.anythingElse,
      vr.attachments,
      vr.creationDatetime,
      vr.status,
      vr.currentApproverIndex,
      vr.vehicleNumber,
      vr.visitorTagNumber,

      -- ✅ New plant fields
      vr.plantSite,
      vr.plantArea,
      vr.plantAreaOther
    FROM VisitRequests vr
  `;

  if (filterTicketNumber) {
    requestsSql += " WHERE vr.ticketNumber = @ticketNumber";
    request.input("ticketNumber", sql.NVarChar(50), filterTicketNumber);
  }

  const [requestsResult, guestsResult, approvalsResult, employeesResult] =
    await Promise.all([
      request.query(requestsSql),
      pool
        .request()
        .query(
          "SELECT id, ticketNumber, guestIndex, name, number, email, company, designation, qrCode, checkedIn, checkInTime, checkOutTime, picture FROM Guests"
        ),
      pool
        .request()
        .query(
          "SELECT id, ticketNumber, approverId, approverEmail, status, [timestamp], reason, allottedPerson FROM Approvals"
        ),
      pool
        .request()
        .query(
          "SELECT empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid FROM Employees"
        ),
    ]);

  const employeesById = new Map();
  for (const emp of employeesResult.recordset) {
    employeesById.set(emp.empid, emp);
  }

  const guestsByTicket = new Map();
  for (const g of guestsResult.recordset) {
    if (!guestsByTicket.has(g.ticketNumber)) {
      guestsByTicket.set(g.ticketNumber, []);
    }
    guestsByTicket.get(g.ticketNumber).push({
      name: g.name,
      number: g.number,
      email: g.email,
      company: g.company,
      designation: g.designation,
      picture: g.picture || undefined,
      qrCode: g.qrCode || undefined,
      checkedIn: g.checkedIn ? true : false,
      checkInTime: toIsoOrNull(g.checkInTime) || undefined,
      checkOutTime: toIsoOrNull(g.checkOutTime) || undefined,
    });
  }

  const approvalsByTicket = new Map();
  for (const a of approvalsResult.recordset) {
    if (!approvalsByTicket.has(a.ticketNumber)) {
      approvalsByTicket.set(a.ticketNumber, []);
    }
    approvalsByTicket.get(a.ticketNumber).push({
      approverId: a.approverId,
      approverEmail: a.approverEmail,
      status: a.status,
      timestamp: toIsoOrNull(a.timestamp) || undefined,
      reason: a.reason || undefined,
      allottedPerson: a.allottedPerson || undefined,
    });
  }

  const hydrated = requestsResult.recordset.map((r) => {
    const empDetails = employeesById.get(r.empid) || null;
    const guests = guestsByTicket.get(r.ticketNumber) || [];
    const approvals = approvalsByTicket.get(r.ticketNumber) || [];

    return {
      ticketNumber: r.ticketNumber,
      empDetails,
      visitorCategory: r.visitorCategory,
      visitorCategoryOther: r.visitorCategoryOther || undefined,
      numberOfGuests: r.numberOfGuests,
      guests,
      purposeOfVisit: r.purposeOfVisit,
      tentativeArrival: toIsoOrNull(r.tentativeArrival),
      tentativeDuration: r.tentativeDuration,
      vehicleRequired: r.vehicleRequired ? true : false,
      lunchRequired: r.lunchRequired ? true : false,
      lunchCategory: r.lunchCategory || undefined,
      dietaryRequirements: r.dietaryRequirements || undefined,
      meetingWith: r.meetingWith,
      typeOfLocation: r.typeOfLocation,
      locationToVisit: r.locationToVisit,
      areaToVisit: r.areaToVisit,
      cellLineVisit: r.cellLineVisit ? true : false,
      anythingElse: r.anythingElse || undefined,
      attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
      _creationDatetime: toIsoOrNull(r.creationDatetime),
      get creationDatetime() {
        return this._creationDatetime;
      },
      set creationDatetime(value) {
        this._creationDatetime = value;
      },
      status: r.status,
      approvals,
      currentApproverIndex: r.currentApproverIndex,
      vehicleNumber: r.vehicleNumber || undefined,
      visitorTagNumber: r.visitorTagNumber || undefined,

      // ✅ expose plant fields to frontend (optional)
      plantSite: r.plantSite || undefined,
      plantArea: r.plantArea || undefined,
      plantAreaOther: r.plantAreaOther || undefined,
    };
  });

  return hydrated;
}

// ------------------------- WhatsApp Notifications -------------------------

async function notifyGuestsOnApproval(ticketNumber) {
  try {
    const pool = await getPool();

    const guestsResult = await pool
      .request()
      .input("ticketNumber", sql.NVarChar(50), ticketNumber)
      .query(
        "SELECT name, number, email, company, designation, qrCode FROM Guests WHERE ticketNumber = @ticketNumber"
      );

    const reqResult = await pool
      .request()
      .input("ticketNumber", sql.NVarChar(50), ticketNumber)
      .query(
        "SELECT locationToVisit, tentativeArrival, meetingWith FROM VisitRequests WHERE ticketNumber = @ticketNumber"
      );

    if (reqResult.recordset.length === 0) {
      console.warn(
        `[WhatsApp] No VisitRequest found for ticket ${ticketNumber}`
      );
      return;
    }

    const vr = reqResult.recordset[0];
    const dateStr = vr.tentativeArrival
      ? new Date(vr.tentativeArrival).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    for (const g of guestsResult.recordset) {
      if (!g.number) continue;

      let phone = String(g.number).trim();

      if (!phone.startsWith("+")) {
        phone = phone.replace(/\s+/g, "");
        if (phone.startsWith("0")) {
          phone = phone.replace(/^0+/, "");
        }
        if (!phone.startsWith("91")) {
          phone = "91" + phone;
        }
        phone = "+" + phone;
      }

      const lines = [
        `Dear ${g.name || "Guest"},`,
        "",
        `Your visit to Premier Energies has been *approved*.`,
        "",
        `Ticket: ${ticketNumber}`,
        vr.meetingWith ? `Meeting with: ${vr.meetingWith}` : null,
        vr.locationToVisit ? `Location: ${vr.locationToVisit}` : null,
        dateStr ? `Tentative arrival: ${dateStr}` : null,
        "",
        `We are also sending your entry QR in this chat, please show it at the gate to check-in.`,
        "",
        `Regards, Premier Energies Visitor Management`,
      ].filter(Boolean);

      const msg = lines.join("\n");
      const label = `${(g.name || "Guest").replace(
        /\s+/g,
        "_"
      )}-${ticketNumber}`;

      if (g.qrCode) {
        await sendWhatsAppTextWithQr(phone, msg, g.qrCode, label);
      } else {
        await sendWhatsAppText(phone, msg);
      }
    }
  } catch (err) {
    console.error(
      `[WhatsApp] notifyGuestsOnApproval error for ${ticketNumber}:`,
      err && err.message ? err.message : err
    );
  }
}

// Get all visit requests
app.get(
  "/api/requests",
  asyncHandler(async (req, res) => {
    const data = await fetchHydratedRequests(null);
    res.json({ data });
  })
);

// Get single visit request
app.get(
  "/api/requests/:ticketNumber",
  asyncHandler(async (req, res) => {
    const { ticketNumber } = req.params;
    const data = await fetchHydratedRequests(ticketNumber);
    if (data.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }
    res.json({ data: data[0] });
  })
);

// Upsert a visit request
app.post(
  "/api/requests",
  asyncHandler(async (req, res) => {
    const body = req.body;

    if (
      !body ||
      !body.ticketNumber ||
      !body.empDetails ||
      !body.empDetails.empid
    ) {
      return res
        .status(400)
        .json({ error: "ticketNumber and empDetails.empid are required" });
    }

    const ticketNumber = String(body.ticketNumber);
    const empid = String(body.empDetails.empid);

    const pool = await getPool();

    // Previous status lookup (WhatsApp hook)
    let previousStatus = null;
    try {
      const existing = await pool
        .request()
        .input("ticketNumber", sql.NVarChar(50), ticketNumber)
        .query(
          "SELECT TOP 1 status FROM VisitRequests WHERE ticketNumber = @ticketNumber"
        );
      if (existing.recordset.length > 0) {
        previousStatus = existing.recordset[0].status;
      }
    } catch (e) {
      console.error(
        "[/api/requests] Failed to read previous status:",
        e && e.message ? e.message : e
      );
    }

    // ✅ Derive plant fields if frontend hasn't started sending them yet
    const derivedPlant = derivePlantFieldsFromLocation(body.locationToVisit);

    const plantSite = body.plantSite || derivedPlant.plantSite || null;
    const plantArea = body.plantArea || derivedPlant.plantArea || null;
    const plantAreaOther =
      body.plantAreaOther || derivedPlant.plantAreaOther || null;

    const tx = new sql.Transaction(pool);

    try {
      await tx.begin();

      // Upsert VisitRequests
      const req1 = new sql.Request(tx);
      req1
        .input("ticketNumber", sql.NVarChar(50), ticketNumber)
        .input("empid", sql.NVarChar(50), empid)
        .input("visitorCategory", sql.NVarChar(100), body.visitorCategory || "")
        .input(
          "visitorCategoryOther",
          sql.NVarChar(255),
          body.visitorCategoryOther || null
        )
        .input("numberOfGuests", sql.Int, body.numberOfGuests || 0)
        .input(
          "purposeOfVisit",
          sql.NVarChar(sql.MAX),
          body.purposeOfVisit || ""
        )
        .input(
          "tentativeArrival",
          sql.DateTime2,
          body.tentativeArrival ? new Date(body.tentativeArrival) : new Date()
        )
        .input(
          "tentativeDuration",
          sql.NVarChar(100),
          body.tentativeDuration || ""
        )
        .input("vehicleRequired", sql.Bit, !!body.vehicleRequired)
        .input("vehicleNumber", sql.NVarChar(100), body.vehicleNumber || null)
        .input("lunchRequired", sql.Bit, !!body.lunchRequired)
        .input("lunchCategory", sql.NVarChar(100), body.lunchCategory || null)
        .input(
          "dietaryRequirements",
          sql.NVarChar(255),
          body.dietaryRequirements || null
        )
        .input("meetingWith", sql.NVarChar(255), body.meetingWith || "")
        .input(
          "typeOfLocation",
          sql.NVarChar(100),
          body.typeOfLocation || "Office"
        )
        .input(
          "locationToVisit",
          sql.NVarChar(1000),
          body.locationToVisit || ""
        )
        .input("areaToVisit", sql.NVarChar(255), body.areaToVisit || "")
        .input("cellLineVisit", sql.Bit, !!body.cellLineVisit)
        .input("anythingElse", sql.NVarChar(sql.MAX), body.anythingElse || null)
        .input(
          "attachments",
          sql.NVarChar(sql.MAX),
          body.attachments ? JSON.stringify(body.attachments) : null
        )
        .input(
          "creationDatetime",
          sql.DateTime2,
          body.creationDatetime ? new Date(body.creationDatetime) : new Date()
        )
        .input("status", sql.NVarChar(20), body.status || "pending")
        .input(
          "currentApproverIndex",
          sql.Int,
          typeof body.currentApproverIndex === "number"
            ? body.currentApproverIndex
            : 0
        )
        .input(
          "visitorTagNumber",
          sql.NVarChar(100),
          body.visitorTagNumber || null
        )
        // ✅ New Plant fields
        .input("plantSite", sql.NVarChar(10), plantSite)
        .input("plantArea", sql.NVarChar(255), plantArea)
        .input("plantAreaOther", sql.NVarChar(255), plantAreaOther);

      const upsertVisitSql = `
IF EXISTS (SELECT 1 FROM VisitRequests WHERE ticketNumber = @ticketNumber)
BEGIN
  UPDATE VisitRequests
  SET empid = @empid,
      visitorCategory = @visitorCategory,
      visitorCategoryOther = @visitorCategoryOther,
      numberOfGuests = @numberOfGuests,
      purposeOfVisit = @purposeOfVisit,
      tentativeArrival = @tentativeArrival,
      tentativeDuration = @tentativeDuration,
      vehicleRequired = @vehicleRequired,
      vehicleNumber = @vehicleNumber,
      lunchRequired = @lunchRequired,
      lunchCategory = @lunchCategory,
      dietaryRequirements = @dietaryRequirements,
      meetingWith = @meetingWith,
      typeOfLocation = @typeOfLocation,
      locationToVisit = @locationToVisit,
      areaToVisit = @areaToVisit,
      cellLineVisit = @cellLineVisit,
      anythingElse = @anythingElse,
      attachments = @attachments,
      creationDatetime = @creationDatetime,
      status = @status,
      currentApproverIndex = @currentApproverIndex,
      visitorTagNumber = @visitorTagNumber,
      plantSite = @plantSite,
      plantArea = @plantArea,
      plantAreaOther = @plantAreaOther
  WHERE ticketNumber = @ticketNumber;
END
ELSE
BEGIN
  INSERT INTO VisitRequests (
    ticketNumber,
    empid,
    visitorCategory,
    visitorCategoryOther,
    numberOfGuests,
    purposeOfVisit,
    tentativeArrival,
    tentativeDuration,
    vehicleRequired,
    vehicleNumber,
    lunchRequired,
    lunchCategory,
    dietaryRequirements,
    meetingWith,
    typeOfLocation,
    locationToVisit,
    areaToVisit,
    cellLineVisit,
    anythingElse,
    attachments,
    creationDatetime,
    status,
    currentApproverIndex,
    visitorTagNumber,
    plantSite,
    plantArea,
    plantAreaOther
  )
  VALUES (
    @ticketNumber,
    @empid,
    @visitorCategory,
    @visitorCategoryOther,
    @numberOfGuests,
    @purposeOfVisit,
    @tentativeArrival,
    @tentativeDuration,
    @vehicleRequired,
    @vehicleNumber,
    @lunchRequired,
    @lunchCategory,
    @dietaryRequirements,
    @meetingWith,
    @typeOfLocation,
    @locationToVisit,
    @areaToVisit,
    @cellLineVisit,
    @anythingElse,
    @attachments,
    @creationDatetime,
    @status,
    @currentApproverIndex,
    @visitorTagNumber,
    @plantSite,
    @plantArea,
    @plantAreaOther
  );
END;
`;
      await req1.query(upsertVisitSql);

      // Replace Guests for this ticketNumber
      const delGuestsReq = new sql.Request(tx);
      await delGuestsReq
        .input("ticketNumber", sql.NVarChar(50), ticketNumber)
        .query("DELETE FROM Guests WHERE ticketNumber = @ticketNumber");

      if (Array.isArray(body.guests)) {
        for (let i = 0; i < body.guests.length; i++) {
          const g = body.guests[i] || {};
          const gr = new sql.Request(tx);
          gr.input("ticketNumber", sql.NVarChar(50), ticketNumber)
            .input("guestIndex", sql.Int, i)
            .input("name", sql.NVarChar(255), g.name || "")
            .input("number", sql.NVarChar(50), g.number || "")
            .input("email", sql.NVarChar(255), g.email || "")
            .input("company", sql.NVarChar(255), g.company || "")
            .input("designation", sql.NVarChar(255), g.designation || "")
            .input("qrCode", sql.NVarChar(255), g.qrCode || null)
            .input("checkedIn", sql.Bit, !!g.checkedIn)
            .input(
              "checkInTime",
              sql.DateTime2,
              g.checkInTime ? new Date(g.checkInTime) : null
            )
            .input(
              "checkOutTime",
              sql.DateTime2,
              g.checkOutTime ? new Date(g.checkOutTime) : null
            )
            .input("picture", sql.NVarChar(sql.MAX), g.picture || null);

          const insertGuestSql = `
            INSERT INTO Guests (
              ticketNumber,
              guestIndex,
              name,
              number,
              email,
              company,
              designation,
              qrCode,
              checkedIn,
              checkInTime,
              checkOutTime,
              picture
            )
            VALUES (
              @ticketNumber,
              @guestIndex,
              @name,
              @number,
              @email,
              @company,
              @designation,
              @qrCode,
              @checkedIn,
              @checkInTime,
              @checkOutTime,
              @picture
            );
          `;
          await gr.query(insertGuestSql);
        }
      }

      // Replace Approvals for this ticketNumber
      const delApprovalsReq = new sql.Request(tx);
      await delApprovalsReq
        .input("ticketNumber", sql.NVarChar(50), ticketNumber)
        .query("DELETE FROM Approvals WHERE ticketNumber = @ticketNumber");

      if (Array.isArray(body.approvals)) {
        for (const a of body.approvals) {
          const ar = new sql.Request(tx);
          ar.input("ticketNumber", sql.NVarChar(50), ticketNumber)
            .input("approverId", sql.NVarChar(50), a.approverId || "")
            .input("approverEmail", sql.NVarChar(255), a.approverEmail || "")
            .input("status", sql.NVarChar(20), a.status || "pending")
            .input(
              "timestamp",
              sql.DateTime2,
              a.timestamp ? new Date(a.timestamp) : null
            )
            .input("reason", sql.NVarChar(sql.MAX), a.reason || null)
            .input(
              "allottedPerson",
              sql.NVarChar(255),
              a.allottedPerson || null
            );

          const insertApprovalSql = `
INSERT INTO Approvals (
  ticketNumber,
  approverId,
  approverEmail,
  status,
  [timestamp],
  reason,
  allottedPerson
)
VALUES (
  @ticketNumber,
  @approverId,
  @approverEmail,
  @status,
  @timestamp,
  @reason,
  @allottedPerson
);
`;
          await ar.query(insertApprovalSql);
        }
      }

      await tx.commit();

      const newStatus = body.status || "pending";

      if (newStatus === "approved" && previousStatus !== "approved") {
        notifyGuestsOnApproval(ticketNumber).catch((err) => {
          console.error(
            "[/api/requests] WhatsApp notify error:",
            err && err.message ? err.message : err
          );
        });
      }

      const [saved] = await fetchHydratedRequests(ticketNumber);
      res.status(200).json({ data: saved });
    } catch (err) {
      await tx.rollback();
      console.error("[/api/requests] Error:", err);
      res.status(500).json({ error: "Failed to save request" });
    }
  })
);

// ------------------------- History Entries -------------------------

app.get(
  "/api/history/:ticketNumber",
  asyncHandler(async (req, res) => {
    const { ticketNumber } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("ticketNumber", sql.NVarChar(50), ticketNumber)
      .query(
        "SELECT id, ticketNumber, userId, comment, actionType, beforeState, afterState, [timestamp] FROM HistoryEntries WHERE ticketNumber = @ticketNumber ORDER BY [timestamp] ASC"
      );

    const data = result.recordset.map((h) => ({
      ticketNumber: h.ticketNumber,
      userId: h.userId,
      comment: h.comment,
      actionType: h.actionType,
      beforeState: h.beforeState,
      afterState: h.afterState,
      timestamp: toIsoOrNull(h.timestamp),
    }));

    res.json({ data });
  })
);

app.post(
  "/api/history",
  asyncHandler(async (req, res) => {
    const body = req.body;
    if (
      !body ||
      !body.ticketNumber ||
      !body.userId ||
      !body.comment ||
      !body.actionType ||
      !body.beforeState ||
      !body.afterState
    ) {
      return res.status(400).json({ error: "Invalid history payload" });
    }

    const pool = await getPool();
    const r = pool.request();
    r.input("ticketNumber", sql.NVarChar(50), body.ticketNumber)
      .input("userId", sql.NVarChar(50), body.userId)
      .input("comment", sql.NVarChar(sql.MAX), body.comment)
      .input("actionType", sql.NVarChar(50), body.actionType)
      .input("beforeState", sql.NVarChar(50), body.beforeState)
      .input("afterState", sql.NVarChar(50), body.afterState)
      .input(
        "timestamp",
        sql.DateTime2,
        body.timestamp ? new Date(body.timestamp) : new Date()
      );

    const insertHistorySql = `
INSERT INTO HistoryEntries (
  ticketNumber,
  userId,
  comment,
  actionType,
  beforeState,
  afterState,
  [timestamp]
)
VALUES (
  @ticketNumber,
  @userId,
  @comment,
  @actionType,
  @beforeState,
  @afterState,
  @timestamp
);
`;
    await r.query(insertHistorySql);
    res.status(201).json({ success: true });
  })
);

// ------------------------- Guest lookup by phone number -------------------------

app.get(
  "/api/guests/by-number/:number",
  asyncHandler(async (req, res) => {
    const raw = req.params.number || "";
    const digitsOnly = raw.replace(/\D/g, "");

    if (!digitsOnly || digitsOnly.length < 6) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    const last10 = digitsOnly.slice(-10);

    const pool = await getPool();
    const result = await pool
      .request()
      .input("last10", sql.NVarChar(10), last10).query(`
        SELECT TOP 1
          name,
          number,
          email,
          company,
          designation,
          picture
        FROM Guests
        WHERE RIGHT(
          REPLACE(REPLACE(REPLACE(number, '+', ''), ' ', ''), '-', ''),
          10
        ) = @last10
        ORDER BY id DESC;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Guest not found" });
    }

    res.json({ data: result.recordset[0] });
  })
);

// ----------------------------------------------------------------------------
// Static SPA hosting - serves built frontend from ../dist
// ----------------------------------------------------------------------------

const STATIC_DIR = path.resolve(__dirname, "../dist");
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));

  app.get("/", (req, res) => {
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });
}

// ----------------------------------------------------------------------------
// HTTPS options (same certs as your snippet)
// ----------------------------------------------------------------------------

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "mydomain.key")),
  cert: fs.readFileSync(path.join(__dirname, "certs", "d466aacf3db3f299.crt")),
  ca: fs.readFileSync(path.join(__dirname, "certs", "gd_bundle-g2-g1.crt")),
};

// ----------------------------------------------------------------------------
// Global Error Handler
// ----------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("[Error] Unhandled:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ----------------------------------------------------------------------------
// Start HTTPS Server (only after DB init)
// ----------------------------------------------------------------------------

let httpsServer;

async function start() {
  try {
    await initDb();
    httpsServer = https
      .createServer(httpsOptions, app)
      .listen(PORT, HOST, () => {
        console.log(
          `🔒  HTTPS ready → https://${
            HOST === "0.0.0.0" ? "localhost" : HOST
          }:${PORT}`
        );
      });
  } catch (err) {
    console.error("❌  Server start failed:", err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  try {
    if (httpsServer) {
      await new Promise((resolve) => httpsServer.close(resolve));
    }
  } catch (e) {
    console.error("Error closing HTTPS server:", e);
  }

  if (poolPromise) {
    try {
      const pool = await poolPromise;
      await pool.close();
    } catch (e) {
      console.error("Error closing DB pool:", e);
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Export for testing if needed
module.exports = app;
