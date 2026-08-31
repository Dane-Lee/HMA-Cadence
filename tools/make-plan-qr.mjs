/**
 * Render a plan's pairing + plan QR codes to a printable HTML page.
 *
 * Cadence can scan a plan QR but has never had a way to PRODUCE one — the
 * admin-side generator (WORKLOG 1d) and the print sheet (1f) are both unbuilt.
 * This is the stopgap that makes those testable in the meantime, and it is what
 * verified the in-app scanner on a real iPhone on 2026-08-31.
 *
 * It calls the real `buildPlanQr()`, so what comes out is a genuine encrypted
 * envelope sealed to a freshly minted key — not a string shaped like one. If a
 * code from here scans and applies, the whole intake path works.
 *
 * NOT the admin generator. The real one has to run where the admin is, mint the
 * key in front of them, and never let it reach a server. This writes a key to a
 * file on disk, which is fine for a test and wrong for an employee.
 *
 *   node tools/make-plan-qr.mjs --base https://host [--plan p.json] [--out f.html]
 *
 *   --base   required. Origin the QR should point at. The base counts against QR
 *            capacity, so test with the host you will really deploy on.
 *   --plan   plan payload JSON. Omit for a built-in fictional sample.
 *   --out    output file. Default ./plan-qr.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { buildPlanQr, PlanQrError, PLAN_ECC_LEVEL } from '../src/lib/qr/planQr.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg('base');
const planPath = arg('plan');
const outPath = resolve(arg('out', resolve(HERE, '..', 'plan-qr.html')));

if (!baseUrl) {
  console.error('usage: node tools/make-plan-qr.mjs --base <url> [--plan <file.json>] [--out <file.html>]');
  process.exit(1);
}

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Fictional. Mirrors the shape AdminImportPlan demoes, so the two stay comparable.
const SAMPLE = {
  schema_version: 1,
  plan_id: `sample-${Date.now()}`,
  generated_at: new Date().toISOString(),
  source: { app: 'hma-tracker', version: 'make-plan-qr' },
  employee: {
    employee_number: '9001',
    first_name: 'Scanner', last_name: 'Test', name: 'Scanner Test',
    company: 'Hendrickson', department: 'Weld', shift: '2nd', location: 'Navarre, OH',
  },
  assessment: {
    assessment_date: day(0), assessment_type: 'Initial', total_score: 8,
    follow_up_date: day(42), reassessment_date: day(28),
    notes: 'Sample — fictional data only.',
  },
  schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
  exercises: [
    {
      source_exercise_id: 's3', name: 'Bridge',
      instructions: 'On your back, knees bent. Squeeze glutes and lift hips.',
      movement_category: 'single_leg_dip', exercise_type: 'strength',
      default_prescription: '3x10-15', prescription_override: null,
      duration_sec: 258, days: [1, 3, 5], sort_order: 0, image_ref: 'Bridge.webp',
    },
    {
      source_exercise_id: 'sh4', name: 'Wall Slide',
      instructions: 'Back against a wall, arms in a goalpost, slide overhead.',
      movement_category: 'shoulder_reach', exercise_type: 'mobility',
      default_prescription: '2x10', prescription_override: null,
      duration_sec: 150, days: [1, 2, 3, 4, 5], sort_order: 1, image_ref: null,
    },
    {
      source_exercise_id: 'c2', name: 'Chin Tuck',
      instructions: 'Draw the chin straight back without tilting. Hold, release.',
      movement_category: 'cervical_rotation', exercise_type: 'static_stabilization',
      default_prescription: '2x10 hold 5 sec', prescription_override: null,
      duration_sec: 110, days: [2, 4], sort_order: 2, image_ref: null,
    },
  ],
};

const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : SAMPLE;

let qr;
try {
  qr = await buildPlanQr(plan, { baseUrl });
} catch (err) {
  if (err instanceof PlanQrError) {
    // Surface the refusal properly. An oversized plan is the failure the print
    // sheet work actually needs to see, and "it threw" would not help.
    console.error(`\nRefused (${err.code}): ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    process.exit(2);
  }
  throw err;
}

const opts = { errorCorrectionLevel: PLAN_ECC_LEVEL, margin: 2, scale: 8 };
const [pairSvg, planSvg] = await Promise.all([
  QRCode.toString(qr.pairUrl, { ...opts, type: 'svg' }),
  QRCode.toString(qr.planUrl, { ...opts, type: 'svg' }),
]);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const keyIdHex = Array.from(qr.keyId).map((b) => b.toString(16).padStart(2, '0')).join('');

const html = `<!doctype html>
<meta charset="utf-8">
<title>Plan QR — ${esc(plan.employee?.name ?? 'plan')}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; background:#fff; color:#111; margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 2px; }
  .sub { color:#666; margin:0 0 20px; font-size:13px; }
  .codes { display:flex; gap:32px; flex-wrap:wrap; align-items:flex-start; }
  .code { border:1px solid #ddd; border-radius:10px; padding:16px; }
  .code h2 { font-size:15px; margin:0 0 2px; }
  .code p { margin:0 0 10px; color:#666; font-size:12px; }
  /* 340px on screen scans fine. Paper is a separate question and is still open. */
  .code svg { width:340px; height:340px; display:block; }
  .step { background:#fff8e1; border:1px solid #e8c860; border-radius:8px;
          padding:10px 14px; margin-bottom:18px; font-size:13px; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:11px; }
  .meta { margin-top:20px; color:#666; font-size:12px; }
  @media print { .step { border-color:#999; } }
</style>
<h1>${esc(plan.employee?.name ?? 'Plan')} &middot; ${esc(plan.employee?.employee_number ?? '')}</h1>
<p class="sub">Generated by <code>buildPlanQr()</code> — a real encrypted envelope.</p>

<div class="step">
  <strong>Scan the pairing code first.</strong> It stores the key; the plan cannot
  be opened without it. A plan scanned first will sit pending until the device is
  paired, which is correct behaviour rather than a failure.
  <br><br>
  On iOS, if Cadence is installed to the Home Screen, scan from
  <strong>inside the app</strong> (Scan my sheet). A code opened by the phone's
  camera lands in Safari, which has separate storage.
</div>

<div class="codes">
  <div class="code">
    <h2>1 &middot; Pairing code</h2>
    <p>Opens <code>/pair</code></p>
    ${pairSvg}
  </div>
  <div class="code">
    <h2>2 &middot; Plan code</h2>
    <p>Opens <code>/plan</code></p>
    ${planSvg}
  </div>
</div>

<p class="meta">
  Base <code>${esc(baseUrl)}</code><br>
  Plan ${qr.planBytes} bytes of ${qr.capacity} (headroom ${qr.headroom}) &middot;
  pairing ${qr.pairBytes} bytes &middot; ecc ${PLAN_ECC_LEVEL} &middot; key id <code>${keyIdHex}</code><br>
  ${plan.exercises?.length ?? 0} exercises
</p>
`;

writeFileSync(outPath, html, 'utf8');
console.log(`base       : ${baseUrl}`);
console.log(`plan bytes : ${qr.planBytes} / ${qr.capacity} (headroom ${qr.headroom})`);
console.log(`key id     : ${keyIdHex}`);
console.log(`written    : ${outPath}`);
