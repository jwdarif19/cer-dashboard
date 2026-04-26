/**
 * Discharge Readiness Dashboard — SMART on FHIR R4
 * ─────────────────────────────────────────────────
 * Flow:
 *  1.  FHIR.oauth2.ready()  →  exchange auth code for access token
 *  2.  Read Patient resource (demographics)
 *  3.  Fetch Observations, Conditions, MedicationRequests, DiagnosticReports
 *  4.  Apply a simple rules-based discharge readiness score
 *  5.  Render everything into the HTML template
 */

// ── Vital sign LOINC codes we care about ──────────────────────────────────
const VITAL_LOINCS = {
  "8310-5":  "Body Temperature",
  "8867-4":  "Heart Rate",
  "9279-1":  "Respiratory Rate",
  "55284-4": "Blood Pressure",
  "59408-5": "Oxygen Saturation (SpO2)",
  "29463-7": "Body Weight",
  "8302-2":  "Body Height",
  "39156-5": "BMI",
  "8480-6":  "Systolic BP",
  "8462-4":  "Diastolic BP"
};

// ── Normal ranges for basic discharge readiness logic ─────────────────────
const NORMAL_RANGES = {
  "8310-5":  { min: 36.1, max: 38.2, unit: "°C" },  // Temp
  "8867-4":  { min: 60,   max: 100,  unit: "bpm" }, // HR
  "9279-1":  { min: 12,   max: 20,   unit: "/min" }, // RR
  "59408-5": { min: 95,   max: 100,  unit: "%" },    // SpO2
  "8480-6":  { min: 90,   max: 140,  unit: "mmHg" }, // Systolic BP
  "8462-4":  { min: 60,   max: 90,   unit: "mmHg" }  // Diastolic BP
};

// ── Global state ──────────────────────────────────────────────────────────
let _debugData = {};

// ── Unhide page immediately (removes flash-of-hidden-content risk) ─────────
document.documentElement.removeAttribute("hidden");

// ── Entry point ───────────────────────────────────────────────────────────
FHIR.oauth2.ready()
  .then(client => {
    return loadAll(client);
  })
  .catch(err => {
    showError("Authentication failed: " + (err.message || err));
  });

// ── Load all resources ────────────────────────────────────────────────────
async function loadAll(client) {
  try {
    // 1. Show logged-in user
    if (client.user) {
      try {
        const user = await client.user.read();
        document.getElementById("user-info").textContent =
          "Logged in as: " + formatName(user.name) + " (" + (user.resourceType || "User") + ")";
      } catch (_) { /* non-fatal */ }
    }

    // 2. Patient demographics
    const patient = await client.patient.read();
    _debugData.patient = patient;
    renderPatient(patient);

    // Get patient ID for explicit queries (more reliable with Cerner SMART v2)
    const pid = patient.id;

    // 3. Parallel fetch of all clinical data
    const [observations, conditions, medications, reports] = await Promise.allSettled([
      fetchAllPages(client, "Observation?patient=" + pid + "&category=vital-signs&_sort=-date&_count=20"),
      fetchAllPages(client, "Condition?patient=" + pid + "&clinical-status=active&_count=50"),
      fetchAllPages(client, "MedicationRequest?patient=" + pid + "&status=active&_count=50"),
      fetchAllPages(client, "DiagnosticReport?patient=" + pid + "&_sort=-date&_count=20")
    ]);

    const obs   = observations.status === "fulfilled" ? observations.value : [];
    const conds = conditions.status   === "fulfilled" ? conditions.value   : [];
    const meds  = medications.status  === "fulfilled" ? medications.value  : [];
    const reps  = reports.status      === "fulfilled" ? reports.value      : [];

    _debugData.observations = obs;
    _debugData.conditions   = conds;
    _debugData.medications  = meds;
    _debugData.reports      = reps;

    renderObservations(obs);
    renderConditions(conds);
    renderMedications(meds);
    renderReports(reps);

    // 4. Discharge readiness scoring
    scoreDischargeReadiness(obs, conds, meds, reps);

    // Show app
    hide("loading");
    show("app");

  } catch (err) {
    showError("Failed to load patient data: " + (err.message || JSON.stringify(err)));
    console.error(err);
  }
}

// ── Fetch all pages from a FHIR bundle ───────────────────────────────────
async function fetchAllPages(client, path) {
  let entries = [];
  let url = path;
  while (url) {
    const bundle = await client.request(url);
    if (bundle.entry) {
      entries = entries.concat(bundle.entry.map(e => e.resource).filter(Boolean));
    }
    // Follow 'next' link if present
    const nextLink = (bundle.link || []).find(l => l.relation === "next");
    url = nextLink ? nextLink.url : null;
  }
  return entries;
}

// ── Render patient demographics ───────────────────────────────────────────
function renderPatient(p) {
  setText("pt-name",     formatName(p.name));
  setText("pt-dob",      p.birthDate || "—");
  setText("pt-age",      p.birthDate ? calculateAge(p.birthDate) + " years" : "—");
  setText("pt-gender",   capitalize(p.gender || "—"));
  setText("pt-mrn",      getMRN(p));
  setText("pt-language", getLanguage(p));
}

// ── Render observations table ─────────────────────────────────────────────
function renderObservations(obs) {
  hide("obs-loading");
  if (!obs.length) { show("obs-empty"); return; }

  const tbody = document.getElementById("obs-body");
  // Sort by date descending, show most recent per code
  const seen = new Set();
  const sorted = [...obs].sort((a, b) =>
    new Date(getObsDate(b)) - new Date(getObsDate(a))
  );

  sorted.forEach(o => {
    const code = getObsCode(o);
    if (seen.has(code)) return;
    seen.add(code);

    const name  = getObsName(o);
    const value = getObsValue(o);
    const date  = formatDate(getObsDate(o));
    const range = NORMAL_RANGES[code];
    const numVal = parseFloat(value);
    let statusClass = "";
    let statusLabel = "—";

    if (range && !isNaN(numVal)) {
      if (numVal < range.min || numVal > range.max) {
        statusClass = "abnormal";
        statusLabel = numVal < range.min ? "↓ Low" : "↑ High";
      } else {
        statusClass = "normal";
        statusLabel = "✓ Normal";
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${value}</td>
      <td>${date}</td>
      <td class="${statusClass}">${statusLabel}</td>
    `;
    tbody.appendChild(tr);
  });

  show("obs-table");
}

// ── Render active conditions ──────────────────────────────────────────────
function renderConditions(conds) {
  hide("cond-loading");
  const list = document.getElementById("cond-list");
  if (!conds.length) { show("cond-empty"); return; }

  conds.forEach(c => {
    const name = c.code?.text
      || c.code?.coding?.[0]?.display
      || "Unknown condition";
    const onset = c.onsetDateTime
      ? " (onset: " + formatDate(c.onsetDateTime) + ")"
      : "";
    const li = document.createElement("li");
    li.textContent = name + onset;
    list.appendChild(li);
  });
}

// ── Render medications ────────────────────────────────────────────────────
function renderMedications(meds) {
  hide("med-loading");
  const list = document.getElementById("med-list");
  if (!meds.length) { show("med-empty"); return; }

  meds.forEach(m => {
    const name = m.medicationCodeableConcept?.text
      || m.medicationCodeableConcept?.coding?.[0]?.display
      || m.medicationReference?.display
      || "Unknown medication";
    const dosage = m.dosageInstruction?.[0]?.text || "";
    const li = document.createElement("li");
    li.textContent = name + (dosage ? " — " + dosage : "");
    list.appendChild(li);
  });
}

// ── Render diagnostic reports ─────────────────────────────────────────────
function renderReports(reps) {
  hide("report-loading");
  const list = document.getElementById("report-list");
  if (!reps.length) { show("report-empty"); return; }

  reps.slice(0, 10).forEach(r => {
    const title  = r.code?.text || r.code?.coding?.[0]?.display || "Report";
    const date   = formatDate(r.effectiveDateTime || r.issued);
    const status = r.status || "—";
    const conclusion = r.conclusion || "";

    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${title}</strong> — ${date}
      <span class="badge badge-${status}">${status}</span>
      ${conclusion ? `<br><em>${conclusion}</em>` : ""}
    `;
    list.appendChild(li);
  });
}

// ── Discharge readiness scoring ───────────────────────────────────────────
// This is a simple rules-based engine — replace with your ML model later.
function scoreDischargeReadiness(obs, conds, meds, reps) {
  const reasons = [];
  let score = 100; // Start optimistic

  // Rule 1: Check vital signs against normal ranges
  const latestObs = {};
  [...obs].sort((a, b) => new Date(getObsDate(b)) - new Date(getObsDate(a)))
    .forEach(o => {
      const code = getObsCode(o);
      if (!latestObs[code]) latestObs[code] = o;
    });

  let abnormalVitals = 0;
  Object.entries(NORMAL_RANGES).forEach(([code, range]) => {
    const o = latestObs[code];
    if (!o) return;
    const val = parseFloat(getObsValue(o));
    if (!isNaN(val) && (val < range.min || val > range.max)) {
      abnormalVitals++;
      reasons.push({
        type: "warning",
        text: `Abnormal ${getObsName(o)}: ${val} ${range.unit} (normal: ${range.min}–${range.max})`
      });
      score -= 25;
    }
  });

  // Rule 2: High-acuity conditions
  const highAcuityKeywords = ["sepsis", "icu", "critical", "acute MI", "stroke", "respiratory failure"];
  conds.forEach(c => {
    const name = (c.code?.text || c.code?.coding?.[0]?.display || "").toLowerCase();
    if (highAcuityKeywords.some(k => name.includes(k))) {
      reasons.push({ type: "danger", text: `High-acuity condition: ${c.code?.text || name}` });
      score -= 40;
    }
  });

  // Rule 3: Pending reports (not yet final)
  const pendingReports = reps.filter(r => r.status === "preliminary" || r.status === "registered");
  if (pendingReports.length > 0) {
    reasons.push({
      type: "warning",
      text: `${pendingReports.length} diagnostic report(s) not yet finalized`
    });
    score -= 15;
  }

  // Rule 4: No active medications may indicate incomplete treatment
  if (meds.length === 0 && conds.length > 0) {
    reasons.push({ type: "info", text: "No active medications found — verify treatment completion" });
    score -= 5;
  }

  // Rule 5: Missing vitals
  const criticalVitals = ["8867-4", "9279-1", "59408-5"]; // HR, RR, SpO2
  criticalVitals.forEach(code => {
    if (!latestObs[code]) {
      reasons.push({ type: "info", text: `Missing vital: ${VITAL_LOINCS[code]}` });
      score -= 5;
    }
  });

  score = Math.max(0, score);

  // Classify
  let statusClass, statusText;
  if (score >= 75 && abnormalVitals === 0) {
    statusClass = "status-green";
    statusText  = "✅ Ready to Discharge (Score: " + score + "/100)";
    reasons.unshift({ type: "success", text: "All checked vitals are within normal range." });
  } else if (score >= 40) {
    statusClass = "status-amber";
    statusText  = "⚠️ Near Discharge — Minor Items Outstanding (Score: " + score + "/100)";
  } else {
    statusClass = "status-red";
    statusText  = "🚨 Not Ready / Requires Attention (Score: " + score + "/100)";
  }

  const badge = document.getElementById("discharge-status");
  badge.className = "status-badge " + statusClass;
  badge.textContent = statusText;

  const ul = document.getElementById("status-reasons");
  if (reasons.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No issues detected based on available data.";
    ul.appendChild(li);
  } else {
    reasons.forEach(r => {
      const li = document.createElement("li");
      li.className = "reason-" + r.type;
      li.textContent = r.text;
      ul.appendChild(li);
    });
  }
}

// ── Helper: extract observation LOINC code ────────────────────────────────
function getObsCode(obs) {
  return obs.code?.coding?.[0]?.code || obs.code?.text || "unknown";
}

function getObsName(obs) {
  return obs.code?.text
    || obs.code?.coding?.[0]?.display
    || VITAL_LOINCS[getObsCode(obs)]
    || "Observation";
}

function getObsValue(obs) {
  if (obs.valueQuantity) {
    return obs.valueQuantity.value + " " + (obs.valueQuantity.unit || "");
  }
  if (obs.valueCodeableConcept) {
    return obs.valueCodeableConcept.text || obs.valueCodeableConcept.coding?.[0]?.display || "—";
  }
  if (obs.valueString) return obs.valueString;
  if (obs.component) {
    // e.g. Blood Pressure has systolic/diastolic components
    return obs.component
      .map(c => (c.code?.text || "") + ": " + (c.valueQuantity?.value || "?") + " " + (c.valueQuantity?.unit || ""))
      .join(" | ");
  }
  return "—";
}

function getObsDate(obs) {
  return obs.effectiveDateTime || obs.effectivePeriod?.start || obs.issued || "";
}

// ── Helper: patient name ──────────────────────────────────────────────────
function formatName(nameArr) {
  if (!nameArr || !nameArr.length) return "—";
  const n = nameArr[0];
  const given  = (n.given  || []).join(" ");
  const family = Array.isArray(n.family) ? n.family.join(" ") : (n.family || "");
  return [given, family].filter(Boolean).join(" ") || n.text || "—";
}

function getMRN(patient) {
  const id = (patient.identifier || []).find(i =>
    i.type?.coding?.some(c => c.code === "MR") ||
    i.type?.text?.toLowerCase().includes("mrn")
  );
  return id?.value || patient.id || "—";
}

function getLanguage(patient) {
  return patient.communication?.[0]?.language?.coding?.[0]?.display
    || patient.communication?.[0]?.language?.text
    || "—";
}

// ── Helper: date formatting ────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (_) { return dateStr; }
}

function calculateAge(birthDate) {
  const today = new Date();
  const dob   = new Date(birthDate);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// ── DOM helpers ───────────────────────────────────────────────────────────
function show(id)  { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id)  { document.getElementById(id)?.classList.add("hidden"); }
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function showError(msg) {
  hide("loading");
  hide("app");
  document.getElementById("error-message").textContent = msg;
  show("error-panel");
}

function toggleDebug() {
  const pre = document.getElementById("debug-output");
  if (pre.classList.contains("hidden")) {
    pre.textContent = JSON.stringify(_debugData, null, 2);
    pre.classList.remove("hidden");
  } else {
    pre.classList.add("hidden");
  }
}
