/**
 * Discharge Readiness Dashboard — SMART on FHIR R4
 * ─────────────────────────────────────────────────
 * Views:
 *   #list   → Patient list (fetched from FHIR Patient search)
 *   #detail → Single patient detail with discharge readiness scoring
 */

// ── Vital sign LOINC codes ────────────────────────────────────────────────
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

// ── Normal ranges ─────────────────────────────────────────────────────────
const NORMAL_RANGES = {
  "8310-5":  { min: 36.1, max: 38.2, unit: "°C"   },
  "8867-4":  { min: 60,   max: 100,  unit: "bpm"  },
  "9279-1":  { min: 12,   max: 20,   unit: "/min" },
  "59408-5": { min: 95,   max: 100,  unit: "%"    },
  "8480-6":  { min: 90,   max: 140,  unit: "mmHg" },
  "8462-4":  { min: 60,   max: 90,   unit: "mmHg" }
};

// ── Global state ──────────────────────────────────────────────────────────
let _client = null;
let _currentPatientId = null;

// ── Unhide page immediately ───────────────────────────────────────────────
document.documentElement.removeAttribute("hidden");

// ── Entry point ───────────────────────────────────────────────────────────
FHIR.oauth2.ready()
  .then(client => {
    _client = client;
    showUserInfo(client);
    // If launched with a patient context, go straight to their detail view.
    // Otherwise show the patient list.
    if (client.patient && client.patient.id) {
      showDetailView(client.patient.id);
    } else {
      showListView();
    }
  })
  .catch(err => {
    showError("Authentication failed: " + (err.message || err));
  });

// ══════════════════════════════════════════════════════════════════════════
// PATIENT LIST VIEW
// ══════════════════════════════════════════════════════════════════════════

async function showListView() {
  hide("loading");
  hide("detail-view");
  hide("error-panel");
  hide("back-btn");
  show("list-view");

  const tbody = document.getElementById("patient-list-body");
  tbody.innerHTML = '<tr><td colspan="6" class="muted" style="padding:16px">Loading patients...</td></tr>';

  try {
    // Cerner requires search params on Patient — use Encounter to get inpatient census
    // Fetch active inpatient/ED encounters and pull their subjects (patients)
    const bundle = await _client.request(
      "Encounter?status=in-progress&_count=20&_include=Encounter:subject"
    );
    const entries = (bundle.entry || []).map(e => e.resource).filter(Boolean);

    // Separate Encounter and Patient resources from the _include response
    let patients = entries.filter(r => r.resourceType === "Patient");
    const encounters = entries.filter(r => r.resourceType === "Encounter");

    // If no patients came back via _include, extract patient IDs from encounters
    // and fetch them individually
    if (!patients.length && encounters.length) {
      const patientIds = [...new Set(
        encounters.map(e => e.subject?.reference?.split("/").pop()).filter(Boolean)
      )];
      const fetched = await Promise.allSettled(
        patientIds.map(id => _client.request(`Patient/${id}`))
      );
      patients = fetched.filter(r => r.status === "fulfilled").map(r => r.value);
    }

    // Fallback: if still no patients (sandbox may not have active encounters),
    // try fetching the context patient's ward neighbours by name initial
    if (!patients.length) {
      const fallback = await _client.request("Patient?name=smart&_count=20");
      patients = (fallback.entry || []).map(e => e.resource).filter(Boolean);
    }

    if (!patients.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted" style="padding:16px">No inpatient encounters found in sandbox.</td></tr>';
      return;
    }

    tbody.innerHTML = "";
    for (const p of patients) {
      const row = await buildPatientRow(p);
      tbody.appendChild(row);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:16px">Could not load patient list: ${err.message}</td></tr>`;
  }
}

async function buildPatientRow(p) {
  const tr = document.createElement("tr");
  tr.style.cursor = "pointer";
  tr.title = "Click to view discharge readiness";

  const name   = formatName(p.name);
  const dob    = p.birthDate || "—";
  const age    = p.birthDate ? calculateAge(p.birthDate) + " y" : "—";
  const gender = capitalize(p.gender || "—");
  const mrn    = getMRN(p);

  // Quick score badge — fetch latest obs only
  let badgeHtml = '<span class="status-badge status-unknown" style="font-size:11px;padding:4px 10px">Calculating...</span>';

  tr.innerHTML = `
    <td><strong>${name}</strong></td>
    <td>${dob}</td>
    <td>${age}</td>
    <td>${gender}</td>
    <td>${mrn}</td>
    <td class="readiness-cell">${badgeHtml}</td>
  `;

  tr.addEventListener("click", () => showDetailView(p.id));

  // Async: compute score and update badge
  computeQuickScore(p.id).then(({ statusClass, label }) => {
    const cell = tr.querySelector(".readiness-cell");
    cell.innerHTML = `<span class="status-badge ${statusClass}" style="font-size:11px;padding:4px 10px">${label}</span>`;
  }).catch(() => {
    const cell = tr.querySelector(".readiness-cell");
    cell.innerHTML = '<span class="status-badge status-unknown" style="font-size:11px;padding:4px 10px">Unknown</span>';
  });

  return tr;
}

async function computeQuickScore(pid) {
  // Fetch just the latest vital signs for a quick score
  const bundle = await _client.request(
    `Observation?patient=${pid}&category=vital-signs&_sort=-date&_count=5`
  );
  const obs = (bundle.entry || []).map(e => e.resource).filter(Boolean);
  const { statusClass, statusText } = scoreReadiness(obs, [], [], []);
  // Shorten label for list view
  const label = statusClass === "status-green" ? "✅ Ready"
              : statusClass === "status-amber" ? "⚠️ Near Ready"
              : statusClass === "status-red"   ? "🚨 Not Ready"
              : "—";
  return { statusClass, label };
}

// ══════════════════════════════════════════════════════════════════════════
// PATIENT DETAIL VIEW
// ══════════════════════════════════════════════════════════════════════════

async function showDetailView(patientId) {
  _currentPatientId = patientId;

  hide("list-view");
  hide("error-panel");
  show("loading");
  hide("detail-view");
  show("back-btn");

  // Reset sections
  document.getElementById("obs-body").innerHTML = "";
  document.getElementById("cond-list").innerHTML = "";
  document.getElementById("med-list").innerHTML = "";
  document.getElementById("report-list").innerHTML = "";
  document.getElementById("status-reasons").innerHTML = "";
  document.getElementById("discharge-status").className = "status-badge status-unknown";
  document.getElementById("discharge-status").textContent = "Calculating...";
  ["obs-loading","cond-loading","med-loading","report-loading"].forEach(id => {
    document.getElementById(id)?.classList.remove("hidden");
  });
  ["obs-table","obs-empty","cond-empty","med-empty","report-empty"].forEach(id => {
    document.getElementById(id)?.classList.add("hidden");
  });

  try {
    // Read patient
    const patient = await _client.request(`Patient/${patientId}`);
    renderPatient(patient);

    hide("loading");
    show("detail-view");

    // Fetch clinical data in parallel
    const [obsResult, condsResult, medsResult, repsResult] = await Promise.allSettled([
      _client.request(`Observation?patient=${patientId}&category=vital-signs&_sort=-date&_count=20`),
      _client.request(`Condition?patient=${patientId}&clinical-status=active&_count=50`),
      _client.request(`MedicationRequest?patient=${patientId}&status=active&_count=50`),
      _client.request(`DiagnosticReport?patient=${patientId}&_sort=-date&_count=20`)
    ]);

    const obs   = extractEntries(obsResult);
    const conds = extractEntries(condsResult);
    const meds  = extractEntries(medsResult);
    const reps  = extractEntries(repsResult);

    renderObservations(obs);
    renderConditions(conds);
    renderMedications(meds);
    renderReports(reps);
    renderScore(obs, conds, meds, reps);

  } catch (err) {
    showError("Failed to load patient data: " + (err.message || JSON.stringify(err)));
  }
}

function extractEntries(result) {
  if (result.status !== "fulfilled") return [];
  const bundle = result.value;
  return (bundle.entry || []).map(e => e.resource).filter(Boolean);
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

// ── Render observations ───────────────────────────────────────────────────
function renderObservations(obs) {
  hide("obs-loading");
  if (!obs.length) { show("obs-empty"); return; }

  const tbody = document.getElementById("obs-body");
  const seen = new Set();
  const sorted = [...obs].sort((a, b) => new Date(getObsDate(b)) - new Date(getObsDate(a)));

  sorted.forEach(o => {
    const code = getObsCode(o);
    if (seen.has(code)) return;
    seen.add(code);

    const name    = getObsName(o);
    const value   = getObsValue(o);
    const date    = formatDate(getObsDate(o));
    const range   = NORMAL_RANGES[code];
    const numVal  = parseFloat(value);
    let statusClass = "", statusLabel = "—";

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
    tr.innerHTML = `<td>${name}</td><td>${value}</td><td>${date}</td><td class="${statusClass}">${statusLabel}</td>`;
    tbody.appendChild(tr);
  });

  show("obs-table");
}

// ── Render conditions ─────────────────────────────────────────────────────
function renderConditions(conds) {
  hide("cond-loading");
  const list = document.getElementById("cond-list");
  if (!conds.length) { show("cond-empty"); return; }
  conds.forEach(c => {
    const name  = c.code?.text || c.code?.coding?.[0]?.display || "Unknown condition";
    const onset = c.onsetDateTime ? " (onset: " + formatDate(c.onsetDateTime) + ")" : "";
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
    const name   = m.medicationCodeableConcept?.text
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
    const title      = r.code?.text || r.code?.coding?.[0]?.display || "Report";
    const date       = formatDate(r.effectiveDateTime || r.issued);
    const status     = r.status || "—";
    const conclusion = r.conclusion || "";
    const li = document.createElement("li");
    li.innerHTML = `<strong>${title}</strong> — ${date}
      <span class="badge badge-${status}">${status}</span>
      ${conclusion ? `<br><em>${conclusion}</em>` : ""}`;
    list.appendChild(li);
  });
}

// ── Discharge readiness score ─────────────────────────────────────────────
function scoreReadiness(obs, conds, meds, reps) {
  const reasons = [];
  let score = 100;

  const latestObs = {};
  [...obs].sort((a, b) => new Date(getObsDate(b)) - new Date(getObsDate(a)))
    .forEach(o => { const c = getObsCode(o); if (!latestObs[c]) latestObs[c] = o; });

  let abnormalVitals = 0;
  Object.entries(NORMAL_RANGES).forEach(([code, range]) => {
    const o = latestObs[code];
    if (!o) return;
    const val = parseFloat(getObsValue(o));
    if (!isNaN(val) && (val < range.min || val > range.max)) {
      abnormalVitals++;
      reasons.push({ type: "warning", text: `Abnormal ${getObsName(o)}: ${val} ${range.unit} (normal: ${range.min}–${range.max})` });
      score -= 25;
    }
  });

  const highAcuity = ["sepsis", "icu", "critical", "acute mi", "stroke", "respiratory failure"];
  conds.forEach(c => {
    const name = (c.code?.text || c.code?.coding?.[0]?.display || "").toLowerCase();
    if (highAcuity.some(k => name.includes(k))) {
      reasons.push({ type: "danger", text: `High-acuity condition: ${c.code?.text || name}` });
      score -= 40;
    }
  });

  const pending = reps.filter(r => r.status === "preliminary" || r.status === "registered");
  if (pending.length) {
    reasons.push({ type: "warning", text: `${pending.length} diagnostic report(s) not yet finalized` });
    score -= 15;
  }

  if (meds.length === 0 && conds.length > 0) {
    reasons.push({ type: "info", text: "No active medications found — verify treatment completion" });
    score -= 5;
  }

  ["8867-4", "9279-1", "59408-5"].forEach(code => {
    if (!latestObs[code]) {
      reasons.push({ type: "info", text: `Missing vital: ${VITAL_LOINCS[code]}` });
      score -= 5;
    }
  });

  score = Math.max(0, score);

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

  return { statusClass, statusText, reasons };
}

function renderScore(obs, conds, meds, reps) {
  const { statusClass, statusText, reasons } = scoreReadiness(obs, conds, meds, reps);
  const badge = document.getElementById("discharge-status");
  badge.className = "status-badge " + statusClass;
  badge.textContent = statusText;

  const ul = document.getElementById("status-reasons");
  if (!reasons.length) {
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

// ── Show user info in header ──────────────────────────────────────────────
async function showUserInfo(client) {
  if (!client.user) return;
  try {
    const user = await client.user.read();
    setText("user-info", "Logged in as: " + formatName(user.name));
  } catch (_) {}
}

// ── Observation helpers ───────────────────────────────────────────────────
function getObsCode(o)  { return o.code?.coding?.[0]?.code || o.code?.text || "unknown"; }
function getObsName(o)  { return o.code?.text || o.code?.coding?.[0]?.display || VITAL_LOINCS[getObsCode(o)] || "Observation"; }
function getObsDate(o)  { return o.effectiveDateTime || o.effectivePeriod?.start || o.issued || ""; }
function getObsValue(o) {
  if (o.valueQuantity)      return o.valueQuantity.value + " " + (o.valueQuantity.unit || "");
  if (o.valueCodeableConcept) return o.valueCodeableConcept.text || o.valueCodeableConcept.coding?.[0]?.display || "—";
  if (o.valueString)        return o.valueString;
  if (o.component)          return o.component.map(c => (c.code?.text || "") + ": " + (c.valueQuantity?.value || "?") + " " + (c.valueQuantity?.unit || "")).join(" | ");
  return "—";
}

// ── Patient helpers ───────────────────────────────────────────────────────
function formatName(nameArr) {
  if (!nameArr?.length) return "—";
  const n = nameArr[0];
  const given  = (n.given || []).join(" ");
  const family = Array.isArray(n.family) ? n.family.join(" ") : (n.family || "");
  return [given, family].filter(Boolean).join(" ") || n.text || "—";
}
function getMRN(p) {
  const id = (p.identifier || []).find(i =>
    i.type?.coding?.some(c => c.code === "MR") || i.type?.text?.toLowerCase().includes("mrn")
  );
  return id?.value || p.id || "—";
}
function getLanguage(p) {
  return p.communication?.[0]?.language?.coding?.[0]?.display || p.communication?.[0]?.language?.text || "—";
}

// ── Utility helpers ───────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch (_) { return dateStr; }
}
function calculateAge(birthDate) {
  const today = new Date(), dob = new Date(birthDate);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function showError(msg) {
  hide("loading");
  hide("list-view");
  hide("detail-view");
  setText("error-message", msg);
  show("error-panel");
}
