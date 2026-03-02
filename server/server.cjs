// server.cjs
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") }); // load wave/.env

const fs = require("fs");
const https = require("https");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const sql = require("mssql");

// === WhatsApp Web client import ============================================
const {
  sendWhatsAppText,
  sendWhatsAppTextWithQr,
} = require("./whatsappClient.cjs");

// ----------------------------------------------------------------------------
// Helpers: env + file reading
// ----------------------------------------------------------------------------
function mustGetEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`❌ Missing required env: ${name}`);
    process.exit(1);
  }
  return String(v)
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

function readFileOrExit(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`❌ Failed to read ${label} at: ${filePath}`);
    console.error(e.message || e);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// Time (match DIGI): IST day-bound sessions
// ----------------------------------------------------------------------------
const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30
function currentIstDay() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); // YYYY-MM-DD
}

// ----------------------------------------------------------------------------
// HTTPS port + host (same port for FE + BE)
// ----------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 28443;
const HOST = process.env.HOST || "0.0.0.0";

// ----------------------------------------------------------------------------
// SSO config (must match DIGI)
// ----------------------------------------------------------------------------
const COOKIE_DOMAIN = (process.env.COOKIE_DOMAIN || "").trim(); // ".premierenergies.com" in prod
const ISSUER = process.env.ISSUER || "auth.premierenergies.com";
const AUDIENCE = process.env.AUDIENCE || "apps.premierenergies.com";
const ACCESS_TTL = process.env.ACCESS_TTL || "15m";
const REFRESH_TTL = process.env.REFRESH_TTL || "30d";

const DIGI_ORIGIN = (
  process.env.DIGI_ORIGIN || "https://digi.premierenergies.com"
).replace(/\/+$/, "");
const APP_ORIGIN = (process.env.APP_ORIGIN || "").replace(/\/+$/, "");

// Keys (public required; private used for refresh support)
// If AUTH_PUBLIC_KEY_FILE is not set, fall back to repo path: wave/server/keys/auth-public.pem
const AUTH_PUBLIC_KEY_FILE =
  (process.env.AUTH_PUBLIC_KEY_FILE &&
    String(process.env.AUTH_PUBLIC_KEY_FILE)
      .trim()
      .replace(/^"(.*)"$/, "$1")) ||
  path.resolve(__dirname, "keys", "auth-public.pem");

// If AUTH_PRIVATE_KEY_FILE is not set, fall back to repo path: wave/server/keys/auth-private.pem
const AUTH_PRIVATE_KEY_FILE =
  (process.env.AUTH_PRIVATE_KEY_FILE &&
    String(process.env.AUTH_PRIVATE_KEY_FILE)
      .trim()
      .replace(/^"(.*)"$/, "$1")) ||
  path.resolve(__dirname, "keys", "auth-private.pem");
const AUTH_PUBLIC_KEY = readFileOrExit(
  AUTH_PUBLIC_KEY_FILE,
  "AUTH_PUBLIC_KEY_FILE"
);
const AUTH_PRIVATE_KEY = readFileOrExit(
  AUTH_PRIVATE_KEY_FILE,
  "AUTH_PRIVATE_KEY_FILE"
);

// ----------------------------------------------------------------------------
// DB configs
// ----------------------------------------------------------------------------

// WAVE DB (your existing config, but allow env override)
const waveDbConfig = {
  user: process.env.WAVE_MSSQL_USER || "PEL_DB",
  password: process.env.WAVE_MSSQL_PASSWORD || "V@aN3#@VaN",
  server: process.env.WAVE_MSSQL_SERVER || "10.0.50.17",
  port: Number(process.env.WAVE_MSSQL_PORT) || 1433,
  database: process.env.WAVE_MSSQL_DB || "wave",
  requestTimeout: 100000,
  connectionTimeout: 10000000,
  pool: { idleTimeoutMillis: 300000 },
  options: { encrypt: false, trustServerCertificate: true },
};

// SPOT auth DB (same as DIGI) to source EMP master
const spotDbConfig = {
  user: process.env.MSSQL_USER || "PEL_DB",
  password: process.env.MSSQL_PASSWORD || "V@aN3#@VaN",
  server: process.env.MSSQL_SERVER || "10.0.50.17",
  port: Number(process.env.MSSQL_PORT) || 1433,
  database: process.env.MSSQL_DB_AUTH || "SPOT",
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

// ----------------------------------------------------------------------------
// MSSQL Pools
// ----------------------------------------------------------------------------
let wavePoolPromise;
let spotPoolPromise;

async function getWavePool() {
  if (!wavePoolPromise) wavePoolPromise = sql.connect(waveDbConfig);
  return wavePoolPromise;
}
async function getSpotPool() {
  if (!spotPoolPromise)
    spotPoolPromise = new sql.ConnectionPool(spotDbConfig).connect();
  return spotPoolPromise;
}

// ----------------------------------------------------------------------------
// Plant config (mirrors frontend rules)
// ----------------------------------------------------------------------------
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

function derivePlantFieldsFromLocation(locationToVisit) {
  const out = { plantSite: null, plantArea: null, plantAreaOther: null };
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

  if (!areaText) return out;

  const allowed = PLANT_SUB_OPTIONS[site] || [];
  if (allowed.includes(areaText) && areaText !== "Other") {
    out.plantArea = areaText;
    out.plantAreaOther = null;
    return out;
  }

  out.plantArea = "Other";
  out.plantAreaOther = areaText;
  return out;
}

// ----------------------------------------------------------------------------
// SSO cookie helpers (match DIGI)
// ----------------------------------------------------------------------------
function setSsoCookies(req, res, access, refresh) {
  const shouldSetDomain = !!(COOKIE_DOMAIN && String(COOKIE_DOMAIN).trim());

  const baseCookie = {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  };

  const accessOpts = {
    ...baseCookie,
    path: "/",
    maxAge: 15 * 60 * 1000,
    ...(shouldSetDomain ? { domain: COOKIE_DOMAIN } : {}),
  };

  const refreshOpts = {
    ...baseCookie,
    path: "/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    ...(shouldSetDomain ? { domain: COOKIE_DOMAIN } : {}),
  };

  res.cookie("sso", access, accessOpts);
  res.cookie("sso_refresh", refresh, refreshOpts);
}

function clearSsoCookies(res) {
  const clear = (opts) => {
    res.clearCookie("sso", { path: "/", ...opts });
    res.clearCookie("sso_refresh", { path: "/auth", ...opts });
  };
  clear({});
  if (COOKIE_DOMAIN) clear({ domain: COOKIE_DOMAIN });
}

function issueTokens(payload) {
  const day = currentIstDay();

  const base = {
    sub: payload.sub,
    email: payload.email,
    roles: payload.roles || [],
    apps: payload.apps || [],
    day,
  };

  const access = jwt.sign(base, AUTH_PRIVATE_KEY, {
    algorithm: "RS256",
    expiresIn: ACCESS_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const refresh = jwt.sign({ ...base, typ: "refresh" }, AUTH_PRIVATE_KEY, {
    algorithm: "RS256",
    expiresIn: REFRESH_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  return { access, refresh };
}

// ----------------------------------------------------------------------------
// Redirect builder (to DIGI)
// ----------------------------------------------------------------------------
function absoluteFromReq(req) {
  if (APP_ORIGIN) return APP_ORIGIN;
  const proto = req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

function buildDigiLoginUrl(req, returnTo) {
  const rt = returnTo || absoluteFromReq(req) + "/";
  return `${DIGI_ORIGIN}/login?returnTo=${encodeURIComponent(rt)}`;
}

// ----------------------------------------------------------------------------
// Auth middleware (verify DIGI-issued JWT from cookie)
// ----------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const token = req.cookies?.sso;
  if (!token) {
    return res.status(401).json({
      error: "unauthenticated",
      redirect: buildDigiLoginUrl(req, absoluteFromReq(req) + req.originalUrl),
    });
  }

  try {
    const payload = jwt.verify(token, AUTH_PUBLIC_KEY, {
      algorithms: ["RS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    // Day-bound sessions (match DIGI)
    if (!payload.day || payload.day !== currentIstDay()) {
      clearSsoCookies(res);
      return res.status(401).json({
        error: "session_expired_day_change",
        redirect: buildDigiLoginUrl(
          req,
          absoluteFromReq(req) + req.originalUrl
        ),
      });
    }

    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({
      error: "invalid_token",
      redirect: buildDigiLoginUrl(req, absoluteFromReq(req) + req.originalUrl),
    });
  }
}

function requireWaveApp(req, res, next) {
  const apps = Array.isArray(req.user?.apps) ? req.user.apps : [];
  const allowed = new Set(apps.map((x) => String(x).toLowerCase()));
  if (!allowed.has("wave")) {
    return res.status(403).json({ error: "app_not_allowed" });
  }
  return next();
}

// ----------------------------------------------------------------------------
// DB Init (tables + EMP sync stage)
// ----------------------------------------------------------------------------
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

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EmployeeSyncStage')
BEGIN
  CREATE TABLE EmployeeSyncStage (
    empid         NVARCHAR(50)   NOT NULL,
    empemail      NVARCHAR(255)  NOT NULL,
    empname       NVARCHAR(255)  NOT NULL,
    dept          NVARCHAR(100)  NULL,
    subdept       NVARCHAR(100)  NULL,
    emplocation   NVARCHAR(100)  NULL,
    designation   NVARCHAR(100)  NULL,
    activeflag    INT            NOT NULL,
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
    typeOfLocation       NVARCHAR(100) NOT NULL,
    locationToVisit      NVARCHAR(1000) NOT NULL,
    areaToVisit          NVARCHAR(255) NOT NULL,
    cellLineVisit        BIT           NOT NULL DEFAULT(0),
    anythingElse         NVARCHAR(MAX) NULL,
    attachments          NVARCHAR(MAX) NULL,
    creationDatetime     DATETIME2     NOT NULL,
    status               NVARCHAR(20)  NOT NULL,
    currentApproverIndex INT           NOT NULL DEFAULT(0),
    vehicleNumber        NVARCHAR(100) NULL,
    visitorTagNumber     NVARCHAR(100) NULL,
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

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Approvals')
BEGIN
  CREATE TABLE Approvals (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    ticketNumber   NVARCHAR(50) NOT NULL,
    approverId     NVARCHAR(50) NOT NULL,
    approverEmail  NVARCHAR(255) NOT NULL,
    status         NVARCHAR(20) NOT NULL,
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

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LocationMasters')
BEGIN
  CREATE TABLE LocationMasters (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    locationType  NVARCHAR(20)  NOT NULL, -- Office | Plant | Warehouse
    locationName  NVARCHAR(255) NOT NULL,
    plantSite     NVARCHAR(10)  NULL,
    isCellLine    BIT           NOT NULL DEFAULT(0),
    activeflag    BIT           NOT NULL DEFAULT(1),
    displayOrder  INT           NOT NULL DEFAULT(0),
    createdAt     DATETIME2     NOT NULL DEFAULT(SYSUTCDATETIME()),
    updatedAt     DATETIME2     NOT NULL DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT UQ_LocationMasters_TypeName UNIQUE (locationType, locationName)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowLocationSets')
BEGIN
  CREATE TABLE WorkflowLocationSets (
    id                 INT IDENTITY(1,1) PRIMARY KEY,
    setName            NVARCHAR(120) NOT NULL UNIQUE,
    includeOffice      BIT           NOT NULL DEFAULT(0),
    includeWarehouse   BIT           NOT NULL DEFAULT(0),
    includePlant       BIT           NOT NULL DEFAULT(0),
    requiresManager    BIT           NOT NULL DEFAULT(1),
    plantApprovalMode  NVARCHAR(20)  NOT NULL DEFAULT('none'), -- none|chandra|either
    notes              NVARCHAR(500) NULL,
    activeflag         BIT           NOT NULL DEFAULT(1),
    createdAt          DATETIME2     NOT NULL DEFAULT(SYSUTCDATETIME()),
    updatedAt          DATETIME2     NOT NULL DEFAULT(SYSUTCDATETIME())
  );
END;
`;

// ----------------------------------------------------------------------------
// Employee sync: SPOT..EMP -> WAVE..Employees (for "same employees as DIGI")
// ----------------------------------------------------------------------------
async function getEmpColumns(pool) {
  const r = await pool.request().query(`
    SELECT LOWER(name) AS name
      FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.EMP')
  `);
  return new Set(r.recordset.map((x) => x.name));
}

function pickColumn(cols, candidates) {
  for (const c of candidates) {
    if (cols.has(String(c).toLowerCase())) return c;
  }
  return null;
}

async function syncEmployeesFromSpot() {
  const wavePool = await getWavePool();
  const spotPool = await getSpotPool();

  const cols = await getEmpColumns(spotPool);

  const cEmpId = pickColumn(cols, ["EmpID", "empid", "EmployeeID"]);
  const cEmail = pickColumn(cols, ["EmpEmail", "empemail", "Email"]);
  const cName = pickColumn(cols, ["EmpName", "empname", "FullName", "Name"]);
  const cDept = pickColumn(cols, ["Dept", "Department"]);
  const cSubDept = pickColumn(cols, ["SubDept", "SubDepartment"]);
  const cLoc = pickColumn(cols, ["EmpLocation", "Location", "EmpLocationName"]);
  const cDesig = pickColumn(cols, ["Designation", "Title"]);
  const cActive = pickColumn(cols, ["ActiveFlag", "activeflag", "IsActive"]);
  const cMgr = pickColumn(cols, [
    "ManagerID",
    "managerid",
    "ReportingManagerID",
    "HodId",
  ]);

  if (!cEmpId || !cEmail) {
    console.warn(
      "[EMP Sync] SPOT.dbo.EMP missing EmpID/EmpEmail columns. Skipping sync."
    );
    return;
  }

  const selectSql = `
    SELECT
      CAST(${cEmpId} AS NVARCHAR(50)) AS empid,
      LOWER(LTRIM(RTRIM(CAST(${cEmail} AS NVARCHAR(255))))) AS empemail,
      ${
        cName
          ? `CAST(${cName} AS NVARCHAR(255))`
          : `LOWER(LTRIM(RTRIM(CAST(${cEmail} AS NVARCHAR(255)))))`
      } AS empname,
      ${cDept ? `CAST(${cDept} AS NVARCHAR(100))` : "NULL"} AS dept,
      ${cSubDept ? `CAST(${cSubDept} AS NVARCHAR(100))` : "NULL"} AS subdept,
      ${cLoc ? `CAST(${cLoc} AS NVARCHAR(100))` : "NULL"} AS emplocation,
      ${cDesig ? `CAST(${cDesig} AS NVARCHAR(100))` : "NULL"} AS designation,
      ${cActive ? `CAST(${cActive} AS INT)` : "1"} AS activeflag,
      ${cMgr ? `CAST(${cMgr} AS NVARCHAR(50))` : "NULL"} AS managerid
FROM dbo.EMP
    WHERE ${cEmail} IS NOT NULL
      AND LTRIM(RTRIM(CAST(${cEmail} AS NVARCHAR(255)))) <> ''
      AND ${cEmpId} IS NOT NULL
  `;

  const spotEmployees = await spotPool.request().query(selectSql);
  let rows = spotEmployees.recordset || [];

  // Normalize + filter invalid + dedupe by email (Employees.empemail is UNIQUE)
  const byEmail = new Map();

  for (const r of rows) {
    const empid = String(r.empid || "").trim();
    const empemail = String(r.empemail || "")
      .trim()
      .toLowerCase();

    if (!empid) continue;
    if (!empemail) continue;

    const existing = byEmail.get(empemail);

    // Prefer active employees if duplicates exist
    const rActive = Number.isFinite(r.activeflag) ? Number(r.activeflag) : 1;
    const eActive = existing
      ? Number.isFinite(existing.activeflag)
        ? Number(existing.activeflag)
        : 1
      : -1;

    if (!existing || (eActive !== 1 && rActive === 1)) {
      byEmail.set(empemail, { ...r, empid, empemail, activeflag: rActive });
    }
  }

  rows = Array.from(byEmail.values());
  if (!rows.length) {
    console.warn("[EMP Sync] No employees found in SPOT.dbo.EMP");
    return;
  }

  // Stage + merge into wave Employees
  await wavePool.request().query("TRUNCATE TABLE dbo.EmployeeSyncStage");

  const makeTable = () => {
    const t = new sql.Table("EmployeeSyncStage");
    t.schema = "dbo";
    t.create = false;
    t.columns.add("empid", sql.NVarChar(50), { nullable: false });
    t.columns.add("empemail", sql.NVarChar(255), { nullable: false });
    t.columns.add("empname", sql.NVarChar(255), { nullable: false });
    t.columns.add("dept", sql.NVarChar(100), { nullable: true });
    t.columns.add("subdept", sql.NVarChar(100), { nullable: true });
    t.columns.add("emplocation", sql.NVarChar(100), { nullable: true });
    t.columns.add("designation", sql.NVarChar(100), { nullable: true });
    t.columns.add("activeflag", sql.Int, { nullable: false });
    t.columns.add("managerid", sql.NVarChar(50), { nullable: true });
    return t;
  };

  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const t = makeTable();
    const slice = rows.slice(i, i + CHUNK);
    for (const r of slice) {
      t.rows.add(
        String(r.empid || "").trim(),
        String(r.empemail || "").trim(),
        String(r.empname || "").trim() || String(r.empemail || "").trim(),
        r.dept ? String(r.dept) : null,
        r.subdept ? String(r.subdept) : null,
        r.emplocation ? String(r.emplocation) : null,
        r.designation ? String(r.designation) : null,
        Number.isFinite(r.activeflag) ? Number(r.activeflag) : 1,
        r.managerid ? String(r.managerid) : null
      );
    }
    await wavePool.request().bulk(t);
  }

  await wavePool.request().query(`
    MERGE dbo.Employees AS target
    USING dbo.EmployeeSyncStage AS source
      ON target.empid = source.empid
    WHEN MATCHED THEN
      UPDATE SET
        empemail = source.empemail,
        empname = source.empname,
        dept = source.dept,
        subdept = source.subdept,
        emplocation = source.emplocation,
        designation = source.designation,
        activeflag = source.activeflag,
        managerid = source.managerid
    WHEN NOT MATCHED BY TARGET THEN
      INSERT (empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid)
      VALUES (source.empid, source.empemail, source.empname, source.dept, source.subdept, source.emplocation, source.designation, source.activeflag, source.managerid);
  `);

  console.log(`[EMP Sync] Synced ${rows.length} employees from SPOT -> WAVE`);
}

async function initDb() {
  const wavePool = await getWavePool();
  await wavePool.request().batch(INIT_TABLES_SQL);
  await seedMasters(wavePool);
  await syncEmployeesFromSpot();
  console.log("[DB] Tables ensured + employees synced from SPOT.");
}

async function seedMasters(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM LocationMasters)
    BEGIN
      INSERT INTO LocationMasters (locationType, locationName, plantSite, isCellLine, activeflag, displayOrder)
      VALUES
        ('Office', 'Corporate Office', NULL, 0, 1, 1),
        ('Office', 'City Office', NULL, 0, 1, 2),
        ('Office', 'Delhi Office', NULL, 0, 1, 3),
        ('Office', 'Pune Office', NULL, 0, 1, 4),

        ('Warehouse', 'Annaram', NULL, 0, 1, 1),
        ('Warehouse', 'Axonify', NULL, 0, 1, 2),
        ('Warehouse', 'Bahadurguda', NULL, 0, 1, 3),
        ('Warehouse', 'Narkhuda', NULL, 0, 1, 4),
        ('Warehouse', 'Kothur', NULL, 0, 1, 5),
        ('Warehouse', 'Radiant', NULL, 0, 1, 6),
        ('Warehouse', 'TGIIC', NULL, 0, 1, 7),
        ('Warehouse', 'HSTL', NULL, 0, 1, 8),

        ('Plant', 'P2 - Module (PEPPL)', 'P2', 0, 1, 1),
        ('Plant', 'P2 - MonoPerc Cell (PEPPL)', 'P2', 1, 1, 2),
        ('Plant', 'P2 - TopCon Cell (PEPPL)', 'P2', 1, 1, 3),
        ('Plant', 'P3 - Cell (PEIPL)', 'P3', 1, 1, 4),
        ('Plant', 'P4 - Module (PEIPL)', 'P4', 0, 1, 5),
        ('Plant', 'P5 - Module (PEGEPL)', 'P5', 0, 1, 6),
        ('Plant', 'P6 - Module (PEGEPL)', 'P6', 0, 1, 7),
        ('Plant', 'P7 - Module (PEPPL)', 'P7', 0, 1, 8);
    END;
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM WorkflowLocationSets)
    BEGIN
      INSERT INTO WorkflowLocationSets (
        setName, includeOffice, includeWarehouse, includePlant, requiresManager, plantApprovalMode, notes, activeflag
      )
      VALUES
        ('Office/Warehouse Only', 1, 1, 0, 1, 'none', 'Only reporting manager approval is required.', 1),
        ('Plant (Non Cell Line)', 1, 1, 1, 1, 'chandra', 'If any plant area is included, Chandra approval is required.', 1),
        ('Plant (Cell Line)', 1, 1, 1, 1, 'either', 'If any cell line is included, either Saluja or Chandra can approve.', 1);
    END;
  `);
}

// ----------------------------------------------------------------------------
// Express App Setup
// ----------------------------------------------------------------------------
const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
app.use(compression());
app.use(morgan("combined"));

// ----------------------------------------------------------------------------
// API Helpers
// ----------------------------------------------------------------------------
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function toIsoOrNull(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function toBit(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return s === "true" || s === "1" || s === "yes" ? 1 : 0;
}

// ----------------------------------------------------------------------------
// Public health
// ----------------------------------------------------------------------------
app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    try {
      const pool = await getWavePool();
      await pool.request().query("SELECT 1 AS ok");
      res.json({ status: "ok", db: "up" });
    } catch (err) {
      console.error("[Health] DB check failed:", err.message);
      res.status(500).json({ status: "error", db: "down" });
    }
  })
);

// ----------------------------------------------------------------------------
// Session endpoints (WAVE reads DIGI cookies)
// ----------------------------------------------------------------------------
app.get(
  "/api/session",
  requireAuth,
  requireWaveApp,
  asyncHandler(async (req, res) => {
    const email = String(req.user.email || "").toLowerCase();
    const wavePool = await getWavePool();

    const emp = await wavePool
      .request()
      .input("email", sql.NVarChar(255), email)
      .query(
        "SELECT TOP 1 empid, empemail, empname, dept, subdept, emplocation, designation, activeflag, managerid FROM Employees WHERE empemail=@email"
      );

    res.json({
      user: {
        id: String(req.user.sub || email),
        email,
        roles: req.user.roles || [],
        apps: req.user.apps || [],
      },
      employee: emp.recordset?.[0] || null,
    });
  })
);

app.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const rt = req.cookies?.sso_refresh;
    if (!rt) return res.status(401).json({ error: "no_refresh" });

    try {
      const payload = jwt.verify(rt, AUTH_PUBLIC_KEY, {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      if (
        payload.typ !== "refresh" ||
        !payload.day ||
        payload.day !== currentIstDay()
      ) {
        clearSsoCookies(res);
        return res.status(401).json({ error: "session_expired_day_change" });
      }

      // Re-issue using SAME payload (apps/roles are whatever DIGI issued)
      const user = {
        sub: payload.sub,
        email: payload.email,
        roles: payload.roles || [],
        apps: payload.apps || [],
      };

      const { access, refresh } = issueTokens(user);
      setSsoCookies(req, res, access, refresh);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(401).json({ error: "invalid_refresh" });
    }
  })
);

app.post("/auth/logout", (req, res) => {
  clearSsoCookies(res);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Protect everything else in /api (must be authenticated AND have wave app access)
// ----------------------------------------------------------------------------
app.use("/api", requireAuth, requireWaveApp);

// ----------------------------------------------------------------------------
// Employees (now protected)
// ----------------------------------------------------------------------------
app.get(
  "/api/employees",
  asyncHandler(async (req, res) => {
    const pool = await getWavePool();
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
    const pool = await getWavePool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar(255), String(email).toLowerCase())
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
    const pool = await getWavePool();
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

// ----------------------------------------------------------------------------
// Requests hydration helpers (unchanged)
// ----------------------------------------------------------------------------
async function fetchHydratedRequests(filterTicketNumber = null) {
  const pool = await getWavePool();

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
  for (const emp of employeesResult.recordset)
    employeesById.set(emp.empid, emp);

  const guestsByTicket = new Map();
  for (const g of guestsResult.recordset) {
    if (!guestsByTicket.has(g.ticketNumber))
      guestsByTicket.set(g.ticketNumber, []);
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
    if (!approvalsByTicket.has(a.ticketNumber))
      approvalsByTicket.set(a.ticketNumber, []);
    approvalsByTicket.get(a.ticketNumber).push({
      approverId: a.approverId,
      approverEmail: a.approverEmail,
      status: a.status,
      timestamp: toIsoOrNull(a.timestamp) || undefined,
      reason: a.reason || undefined,
      allottedPerson: a.allottedPerson || undefined,
    });
  }

  return requestsResult.recordset.map((r) => {
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
      creationDatetime: toIsoOrNull(r.creationDatetime),
      status: r.status,
      approvals,
      currentApproverIndex: r.currentApproverIndex,
      vehicleNumber: r.vehicleNumber || undefined,
      visitorTagNumber: r.visitorTagNumber || undefined,
      plantSite: r.plantSite || undefined,
      plantArea: r.plantArea || undefined,
      plantAreaOther: r.plantAreaOther || undefined,
    };
  });
}

// ----------------------------------------------------------------------------
// WhatsApp notification helper (unchanged)
// ----------------------------------------------------------------------------
async function notifyGuestsOnApproval(ticketNumber) {
  try {
    const pool = await getWavePool();

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

    if (reqResult.recordset.length === 0) return;

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
        if (phone.startsWith("0")) phone = phone.replace(/^0+/, "");
        if (!phone.startsWith("91")) phone = "91" + phone;
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

      if (g.qrCode) await sendWhatsAppTextWithQr(phone, msg, g.qrCode, label);
      else await sendWhatsAppText(phone, msg);
    }
  } catch (err) {
    console.error(
      `[WhatsApp] notifyGuestsOnApproval error for ${ticketNumber}:`,
      err?.message || err
    );
  }
}

// ----------------------------------------------------------------------------
// Requests routes (unchanged, but now protected by /api middleware)
// ----------------------------------------------------------------------------
app.get(
  "/api/requests",
  asyncHandler(async (req, res) => {
    const data = await fetchHydratedRequests(null);
    res.json({ data });
  })
);

app.get(
  "/api/requests/:ticketNumber",
  asyncHandler(async (req, res) => {
    const { ticketNumber } = req.params;
    const data = await fetchHydratedRequests(ticketNumber);
    if (data.length === 0)
      return res.status(404).json({ error: "Request not found" });
    res.json({ data: data[0] });
  })
);

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

    const pool = await getWavePool();

    let previousStatus = null;
    try {
      const existing = await pool
        .request()
        .input("ticketNumber", sql.NVarChar(50), ticketNumber)
        .query(
          "SELECT TOP 1 status FROM VisitRequests WHERE ticketNumber = @ticketNumber"
        );
      if (existing.recordset.length > 0)
        previousStatus = existing.recordset[0].status;
    } catch {}

    const derivedPlant = derivePlantFieldsFromLocation(body.locationToVisit);
    const plantSite = body.plantSite || derivedPlant.plantSite || null;
    const plantArea = body.plantArea || derivedPlant.plantArea || null;
    const plantAreaOther =
      body.plantAreaOther || derivedPlant.plantAreaOther || null;

    const tx = new sql.Transaction(pool);

    try {
      await tx.begin();

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
    ticketNumber, empid, visitorCategory, visitorCategoryOther, numberOfGuests,
    purposeOfVisit, tentativeArrival, tentativeDuration,
    vehicleRequired, vehicleNumber,
    lunchRequired, lunchCategory, dietaryRequirements,
    meetingWith, typeOfLocation, locationToVisit, areaToVisit,
    cellLineVisit, anythingElse, attachments, creationDatetime,
    status, currentApproverIndex, visitorTagNumber,
    plantSite, plantArea, plantAreaOther
  )
  VALUES (
    @ticketNumber, @empid, @visitorCategory, @visitorCategoryOther, @numberOfGuests,
    @purposeOfVisit, @tentativeArrival, @tentativeDuration,
    @vehicleRequired, @vehicleNumber,
    @lunchRequired, @lunchCategory, @dietaryRequirements,
    @meetingWith, @typeOfLocation, @locationToVisit, @areaToVisit,
    @cellLineVisit, @anythingElse, @attachments, @creationDatetime,
    @status, @currentApproverIndex, @visitorTagNumber,
    @plantSite, @plantArea, @plantAreaOther
  );
END;
`;
      await req1.query(upsertVisitSql);

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

          await gr.query(`
            INSERT INTO Guests (
              ticketNumber, guestIndex, name, number, email, company, designation,
              qrCode, checkedIn, checkInTime, checkOutTime, picture
            )
            VALUES (
              @ticketNumber, @guestIndex, @name, @number, @email, @company, @designation,
              @qrCode, @checkedIn, @checkInTime, @checkOutTime, @picture
            );
          `);
        }
      }

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

          await ar.query(`
            INSERT INTO Approvals (
              ticketNumber, approverId, approverEmail, status, [timestamp], reason, allottedPerson
            )
            VALUES (
              @ticketNumber, @approverId, @approverEmail, @status, @timestamp, @reason, @allottedPerson
            );
          `);
        }
      }

      await tx.commit();

      const newStatus = body.status || "pending";
      if (newStatus === "approved" && previousStatus !== "approved") {
        notifyGuestsOnApproval(ticketNumber).catch(() => {});
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

// ----------------------------------------------------------------------------
// History routes (unchanged, protected)
// ----------------------------------------------------------------------------
app.get(
  "/api/history/:ticketNumber",
  asyncHandler(async (req, res) => {
    const { ticketNumber } = req.params;
    const pool = await getWavePool();
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

    const pool = await getWavePool();
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

    await r.query(`
      INSERT INTO HistoryEntries (
        ticketNumber, userId, comment, actionType, beforeState, afterState, [timestamp]
      )
      VALUES (
        @ticketNumber, @userId, @comment, @actionType, @beforeState, @afterState, @timestamp
      );
    `);

    res.status(201).json({ success: true });
  })
);

// ----------------------------------------------------------------------------
// Guest lookup by phone (unchanged, protected)
// ----------------------------------------------------------------------------
app.get(
  "/api/guests/by-number/:number",
  asyncHandler(async (req, res) => {
    const raw = req.params.number || "";
    const digitsOnly = raw.replace(/\D/g, "");
    if (!digitsOnly || digitsOnly.length < 6)
      return res.status(400).json({ error: "Invalid phone number" });

    const last10 = digitsOnly.slice(-10);
    const pool = await getWavePool();

    const result = await pool
      .request()
      .input("last10", sql.NVarChar(10), last10).query(`
        SELECT TOP 1 name, number, email, company, designation, picture
          FROM Guests
         WHERE RIGHT(REPLACE(REPLACE(REPLACE(number, '+', ''), ' ', ''), '-', ''), 10) = @last10
         ORDER BY id DESC;
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Guest not found" });
    res.json({ data: result.recordset[0] });
  })
);

// ----------------------------------------------------------------------------
// Masters: Locations + Workflow Sets (protected)
// ----------------------------------------------------------------------------
app.get(
  "/api/masters/locations",
  asyncHandler(async (req, res) => {
    const pool = await getWavePool();
    const result = await pool.request().query(`
      SELECT
        id, locationType, locationName, plantSite, isCellLine, activeflag, displayOrder, createdAt, updatedAt
      FROM LocationMasters
      ORDER BY locationType ASC, displayOrder ASC, locationName ASC
    `);
    res.json({ data: result.recordset });
  })
);

app.post(
  "/api/masters/locations",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const locationType = String(body.locationType || "").trim();
    const locationName = String(body.locationName || "").trim();
    const plantSite = body.plantSite ? String(body.plantSite).trim() : null;
    const isCellLine = toBit(body.isCellLine);
    const activeflag = toBit(
      typeof body.activeflag === "undefined" ? 1 : body.activeflag
    );
    const displayOrder = Number.isFinite(Number(body.displayOrder))
      ? Number(body.displayOrder)
      : 0;

    if (!["Office", "Plant", "Warehouse"].includes(locationType)) {
      return res.status(400).json({
        error: "locationType must be one of: Office, Plant, Warehouse",
      });
    }
    if (!locationName) {
      return res.status(400).json({ error: "locationName is required" });
    }

    const pool = await getWavePool();
    try {
      const result = await pool
        .request()
        .input("locationType", sql.NVarChar(20), locationType)
        .input("locationName", sql.NVarChar(255), locationName)
        .input("plantSite", sql.NVarChar(10), plantSite)
        .input("isCellLine", sql.Bit, isCellLine)
        .input("activeflag", sql.Bit, activeflag)
        .input("displayOrder", sql.Int, displayOrder).query(`
          INSERT INTO LocationMasters (
            locationType, locationName, plantSite, isCellLine, activeflag, displayOrder, createdAt, updatedAt
          )
          OUTPUT INSERTED.*
          VALUES (
            @locationType, @locationName, @plantSite, @isCellLine, @activeflag, @displayOrder, SYSUTCDATETIME(), SYSUTCDATETIME()
          )
        `);
      return res.status(201).json({ data: result.recordset[0] });
    } catch (err) {
      if (String(err?.message || "").toLowerCase().includes("uq_locationmasters")) {
        return res.status(409).json({ error: "Location already exists for this type" });
      }
      throw err;
    }
  })
);

app.put(
  "/api/masters/locations/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid location id" });
    }

    const body = req.body || {};
    const locationType = String(body.locationType || "").trim();
    const locationName = String(body.locationName || "").trim();
    const plantSite = body.plantSite ? String(body.plantSite).trim() : null;
    const isCellLine = toBit(body.isCellLine);
    const activeflag = toBit(
      typeof body.activeflag === "undefined" ? 1 : body.activeflag
    );
    const displayOrder = Number.isFinite(Number(body.displayOrder))
      ? Number(body.displayOrder)
      : 0;

    if (!["Office", "Plant", "Warehouse"].includes(locationType)) {
      return res.status(400).json({
        error: "locationType must be one of: Office, Plant, Warehouse",
      });
    }
    if (!locationName) {
      return res.status(400).json({ error: "locationName is required" });
    }

    const pool = await getWavePool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("locationType", sql.NVarChar(20), locationType)
      .input("locationName", sql.NVarChar(255), locationName)
      .input("plantSite", sql.NVarChar(10), plantSite)
      .input("isCellLine", sql.Bit, isCellLine)
      .input("activeflag", sql.Bit, activeflag)
      .input("displayOrder", sql.Int, displayOrder).query(`
        UPDATE LocationMasters
        SET
          locationType = @locationType,
          locationName = @locationName,
          plantSite = @plantSite,
          isCellLine = @isCellLine,
          activeflag = @activeflag,
          displayOrder = @displayOrder,
          updatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Location not found" });
    }
    res.json({ data: result.recordset[0] });
  })
);

app.delete(
  "/api/masters/locations/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid location id" });
    }
    const pool = await getWavePool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM LocationMasters OUTPUT DELETED.id WHERE id = @id");
    if (!result.recordset.length) {
      return res.status(404).json({ error: "Location not found" });
    }
    res.json({ success: true });
  })
);

app.get(
  "/api/masters/workflow-sets",
  asyncHandler(async (req, res) => {
    const pool = await getWavePool();
    const result = await pool.request().query(`
      SELECT
        id, setName, includeOffice, includeWarehouse, includePlant, requiresManager,
        plantApprovalMode, notes, activeflag, createdAt, updatedAt
      FROM WorkflowLocationSets
      ORDER BY id ASC
    `);
    res.json({ data: result.recordset });
  })
);

app.post(
  "/api/masters/workflow-sets",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const setName = String(body.setName || "").trim();
    const includeOffice = toBit(body.includeOffice);
    const includeWarehouse = toBit(body.includeWarehouse);
    const includePlant = toBit(body.includePlant);
    const requiresManager = toBit(
      typeof body.requiresManager === "undefined" ? 1 : body.requiresManager
    );
    const plantApprovalMode = String(body.plantApprovalMode || "none").trim();
    const notes = body.notes ? String(body.notes).trim() : null;
    const activeflag = toBit(
      typeof body.activeflag === "undefined" ? 1 : body.activeflag
    );

    if (!setName) {
      return res.status(400).json({ error: "setName is required" });
    }
    if (!["none", "chandra", "either"].includes(plantApprovalMode)) {
      return res
        .status(400)
        .json({ error: "plantApprovalMode must be one of: none, chandra, either" });
    }

    const pool = await getWavePool();
    try {
      const result = await pool
        .request()
        .input("setName", sql.NVarChar(120), setName)
        .input("includeOffice", sql.Bit, includeOffice)
        .input("includeWarehouse", sql.Bit, includeWarehouse)
        .input("includePlant", sql.Bit, includePlant)
        .input("requiresManager", sql.Bit, requiresManager)
        .input("plantApprovalMode", sql.NVarChar(20), plantApprovalMode)
        .input("notes", sql.NVarChar(500), notes)
        .input("activeflag", sql.Bit, activeflag).query(`
          INSERT INTO WorkflowLocationSets (
            setName, includeOffice, includeWarehouse, includePlant,
            requiresManager, plantApprovalMode, notes, activeflag, createdAt, updatedAt
          )
          OUTPUT INSERTED.*
          VALUES (
            @setName, @includeOffice, @includeWarehouse, @includePlant,
            @requiresManager, @plantApprovalMode, @notes, @activeflag,
            SYSUTCDATETIME(), SYSUTCDATETIME()
          )
        `);
      return res.status(201).json({ data: result.recordset[0] });
    } catch (err) {
      if (String(err?.message || "").toLowerCase().includes("unique")) {
        return res.status(409).json({ error: "Workflow set name already exists" });
      }
      throw err;
    }
  })
);

app.put(
  "/api/masters/workflow-sets/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid workflow set id" });
    }

    const body = req.body || {};
    const setName = String(body.setName || "").trim();
    const includeOffice = toBit(body.includeOffice);
    const includeWarehouse = toBit(body.includeWarehouse);
    const includePlant = toBit(body.includePlant);
    const requiresManager = toBit(
      typeof body.requiresManager === "undefined" ? 1 : body.requiresManager
    );
    const plantApprovalMode = String(body.plantApprovalMode || "none").trim();
    const notes = body.notes ? String(body.notes).trim() : null;
    const activeflag = toBit(
      typeof body.activeflag === "undefined" ? 1 : body.activeflag
    );

    if (!setName) {
      return res.status(400).json({ error: "setName is required" });
    }
    if (!["none", "chandra", "either"].includes(plantApprovalMode)) {
      return res
        .status(400)
        .json({ error: "plantApprovalMode must be one of: none, chandra, either" });
    }

    const pool = await getWavePool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("setName", sql.NVarChar(120), setName)
      .input("includeOffice", sql.Bit, includeOffice)
      .input("includeWarehouse", sql.Bit, includeWarehouse)
      .input("includePlant", sql.Bit, includePlant)
      .input("requiresManager", sql.Bit, requiresManager)
      .input("plantApprovalMode", sql.NVarChar(20), plantApprovalMode)
      .input("notes", sql.NVarChar(500), notes)
      .input("activeflag", sql.Bit, activeflag).query(`
        UPDATE WorkflowLocationSets
        SET
          setName = @setName,
          includeOffice = @includeOffice,
          includeWarehouse = @includeWarehouse,
          includePlant = @includePlant,
          requiresManager = @requiresManager,
          plantApprovalMode = @plantApprovalMode,
          notes = @notes,
          activeflag = @activeflag,
          updatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Workflow set not found" });
    }
    res.json({ data: result.recordset[0] });
  })
);

app.delete(
  "/api/masters/workflow-sets/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid workflow set id" });
    }
    const pool = await getWavePool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM WorkflowLocationSets OUTPUT DELETED.id WHERE id = @id");
    if (!result.recordset.length) {
      return res.status(404).json({ error: "Workflow set not found" });
    }
    res.json({ success: true });
  })
);

// ----------------------------------------------------------------------------
// Static SPA hosting (Vite build) with SPA fallback
// ----------------------------------------------------------------------------
const STATIC_DIR = path.resolve(__dirname, "../dist");
const INDEX_HTML = path.join(STATIC_DIR, "index.html");

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/"))
      return next();
    return res.sendFile(INDEX_HTML);
  });
}

// ----------------------------------------------------------------------------
// HTTPS options (unchanged from your current WAVE setup)
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

    // Periodic EMP sync (keeps WAVE aligned with DIGI employee master)
    setInterval(() => {
      syncEmployeesFromSpot().catch((e) =>
        console.error("[EMP Sync] periodic failed:", e?.message || e)
      );
    }, 6 * 60 * 60 * 1000);

    httpsServer = https
      .createServer(httpsOptions, app)
      .listen(PORT, HOST, () => {
        console.log(
          `🔒  HTTPS ready → https://${
            HOST === "0.0.0.0" ? "localhost" : HOST
          }:${PORT}`
        );
        console.log(
          `✅  SSO enabled. Unauthed users should login via: ${DIGI_ORIGIN}/login`
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
    if (httpsServer) await new Promise((resolve) => httpsServer.close(resolve));
  } catch (e) {
    console.error("Error closing HTTPS server:", e);
  }

  try {
    if (wavePoolPromise) {
      const pool = await wavePoolPromise;
      await pool.close();
    }
  } catch {}
  try {
    if (spotPoolPromise) {
      const pool = await spotPoolPromise;
      await pool.close();
    }
  } catch {}

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = app;
