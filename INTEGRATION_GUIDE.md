# SMART on FHIR — Complete Integration Guide
## Discharge Readiness Dashboard on Cerner Sandbox

---

## What's in this folder

```
smart-on-fhir-app/
├── launch.html          ← Step 1: Cerner opens this URL to start the app
├── index.html           ← Step 3: Cerner redirects here after login
├── src/
│   ├── js/app.js        ← All the logic: FHIR calls, scoring, rendering
│   └── css/app.css      ← Dashboard styles
└── INTEGRATION_GUIDE.md ← This file
```

---

## PART 1 — Sign Up for a Cerner / Oracle Health Developer Account

1. Go to: **https://cernercare.com** and sign in (or create a free account).

2. Once logged in, navigate to the **Oracle Health Code Console**:
   **https://code-console.cerner.com**

3. You'll land on **My Applications** where you can register and manage apps.

---

## PART 2 — App Registration (Already Done ✅)

This app has already been registered on the Oracle Health Code Console.

| Field              | Value                                                        |
|--------------------|--------------------------------------------------------------|
| App Name           | Discharge Readiness Dashboard                                |
| Application ID     | `28becaff-9234-48b8-8895-45b9648d6343`                      |
| **Client ID**      | **`87ffc00b-db23-430c-a7e2-a8babbdcc16c`**                  |
| SMART Launch URI   | `https://jwdarif19.github.io/cer-dashboard/launch.html`     |
| Redirect URI       | `https://jwdarif19.github.io/cer-dashboard/`                |
| App Type           | Provider / Online / Public / SMART v2                        |
| FHIR Version       | R4                                                           |
| Support Email      | jwdarif19@gmail.com                                          |

The `launch.html` file already contains the real `client_id`. No further changes needed.

> ⚠️ After any re-registration, wait **10 minutes** before testing — Cerner needs time
> to propagate app details across the sandbox environment.

---

## PART 3 — Host the App (Free via GitHub Pages)

GitHub Pages is the easiest free way to host this static app.

### Steps:
1. Create a new GitHub repository (e.g., `discharge-dashboard`)
2. Upload all files from this folder to the repository
3. Go to your repo → **Settings → Pages**
4. Set Source to **"Deploy from a branch"** → branch: `main` → folder: `/ (root)`
5. Click Save. GitHub will give you a URL like:
   `https://YOUR-USERNAME.github.io/discharge-dashboard/`
6. Your app will be live at that URL in 1–2 minutes.

### Health check URL:
Visit `https://YOUR-USERNAME.github.io/discharge-dashboard/index.html`
to verify the page loads (it will show a loading spinner since there's no FHIR context yet).

---

## PART 4 — Test Against Cerner's Sandbox

### Method A: Test from the Code Console (Recommended for first test)

1. Log into **code.cerner.com**
2. Click on your registered app ("Discharge Readiness Dashboard")
3. Click **"Begin Testing"**
4. Select a test patient from the list
5. Click **"Next"** → **"Launch"**
6. When prompted for credentials, use Cerner's sandbox test credentials:
   - **Username:** `portal`
   - **Password:** `portal`
7. Your app will launch with real (synthetic) patient data from Cerner's sandbox!

### Method B: Test against SMART Health IT Sandbox (No registration needed)

This lets you test your app without even registering on code.cerner.com first.

1. Go to: **https://launch.smarthealthit.org**
2. Set **Launch Type** to: `Provider EHR Launch`
3. Check: `Simulate launch within the EHR user interface`
4. Set **FHIR Version** to: `R4`
5. Select a test patient and a test provider from the dropdowns
6. In **App Launch URL**, enter:
   `https://YOUR-USERNAME.github.io/discharge-dashboard/launch.html`
7. Click the green **"Launch App!"** button
8. Your dashboard will open inside a simulated EHR with patient data!

> Note: The SMART Health IT Sandbox does not validate client_id,
> so you can test without a real Cerner account.

---

## PART 5 — Embed Inside Cerner PowerChart (MPages Integration)

Once your app works in the sandbox, you can embed it directly inside
the Cerner PowerChart clinical UI so clinicians never leave their workflow.

### What you need to add to each HTML file (launch.html, index.html):

```html
<!-- Add 'hidden' attribute to <html> tag to prevent flash of unstyled content -->
<html lang="en" hidden>

<head>
  <!-- Required for IE compatibility in PowerChart's embedded browser -->
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />

  <!-- Cerner Smart Embeddable Library CSS — prevents Clickjacking attacks -->
  <link rel="stylesheet"
    href="./lib/cerner-smart-embeddable-lib-[version].min.css">
</head>

<body>
  <!-- Your app content here -->

  <!-- Required polyfill for ES2015+ support -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-polyfill/6.26.0/polyfill.min.js"></script>

  <!-- Cerner Smart Embeddable Library JS -->
  <script src="./lib/cerner-smart-embeddable-lib-[version].min.js"></script>
</body>
```

### Where to get the Cerner Smart Embeddable Library:
- https://github.com/cerner/cerner-smart-embeddable-lib
- Download the latest release and place in your `/lib/` folder

### What happens after embedding:
- A Cerner admin registers your app as an MPage in PowerChart
- Clinicians see your dashboard as a tab or panel inside a patient's chart
- The app launches automatically with the patient in context — no extra clicks

---

## PART 6 — Moving to Production

When you're ready to go live with a real hospital:

1. **Work with the client's Cerner admin** to register your app in their
   production Cerner environment (not just the sandbox).

2. **Move hosting off GitHub Pages** to a HIPAA-compliant cloud server
   (AWS, Azure, or the hospital's on-premise environment).
   GitHub Pages is public and not suitable for real patient data.

3. **Execute a BAA** (Business Associate Agreement) with your cloud provider.

4. **Enable HTTPS** (already required by SMART on FHIR — no plain HTTP).

5. **Add audit logging** — every patient record access must be logged with
   user ID, timestamp, and patient ID to comply with HIPAA.

6. **Submit for Oracle Health review** if you want your app listed in the
   Oracle Health Marketplace for other hospitals to discover and install.

---

## Cerner Sandbox FHIR Endpoints (R4)

| Purpose              | URL                                                              |
|----------------------|------------------------------------------------------------------|
| Provider FHIR R4     | `https://fhir-ehr-code.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d` |
| Patient Access FHIR  | `https://fhir-myrecord.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d` |
| SMART Metadata       | `[FHIR endpoint]/.well-known/smart-configuration`               |
| Code Console         | `https://code.cerner.com`                                        |
| FHIR R4 API Docs     | `https://docs.oracle.com/en/industries/health/millennium-platform-apis/mfrap/` |

---

## Useful Links

- Oracle Health Developer Portal: https://www.oracle.com/health/developer/
- Official SMART on FHIR Tutorial: https://engineering.cerner.com/smart-on-fhir-tutorial/
- FHIR R4 Specification: https://hl7.org/fhir/R4/
- SMART Health IT Sandbox: https://launch.smarthealthit.org
- fhirclient.js library: https://github.com/smart-on-fhir/client-js
- Cerner FHIR R4 Sandbox Credentials: username `portal` / password `portal`
