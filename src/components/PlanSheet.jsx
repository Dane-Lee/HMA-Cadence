import {
  SHEET_STEPS,
  WRONG_ORDER_NOTE,
  PLAN_CODE_MM,
  PAIR_CODE_MM,
  MIN_MODULE_MM,
} from '../lib/sheet/planSheet.js';

/**
 * The companion sheet the employee walks away with (pipeline item 1f).
 *
 * Layout only -- every decision about wording, ordering and print geometry is
 * in `lib/sheet/planSheet.js`, where the tests can reach it.
 *
 * The codes are injected as SVG markup rather than an `<img>` because a data-URI
 * image is resampled at print time and the whole point of specifying 110mm is
 * that it is a measurement. The source is `QRCode.toString`, which builds the
 * SVG from the payload -- not user text -- so there is no untrusted markup here.
 */
function displayName(employee) {
  if (!employee) return null;
  if (employee.name) return employee.name;
  const joined = `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim();
  return joined || null;
}

function Code({ svg, widthMm, ordinal, label, hint }) {
  return (
    <figure className="plan-sheet__code" style={{ width: `${widthMm}mm` }}>
      <div
        className="plan-sheet__qr"
        style={{ width: `${widthMm}mm`, height: `${widthMm}mm` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption>
        <span className="plan-sheet__ordinal">{ordinal}</span>
        <strong>{label}</strong>
        <span className="plan-sheet__hint">{hint}</span>
      </figcaption>
    </figure>
  );
}

export default function PlanSheet({ payload, codes, issued, keyIdHex }) {
  const employee = payload?.employee ?? null;
  const name = displayName(employee);

  return (
    <section className="plan-sheet" aria-label="Printable exercise sheet">
      <header className="plan-sheet__head">
        <h2>Your Exercise Program</h2>
        <p className="plan-sheet__who">
          {name ?? 'Employee'}
          {employee?.employee_number ? ` · Badge ${employee.employee_number}` : ''}
          {payload?.assessment?.assessment_date ? ` · ${payload.assessment.assessment_date}` : ''}
        </p>
      </header>

      <ol className="plan-sheet__steps">
        {SHEET_STEPS.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>

      <div className="plan-sheet__codes">
        <Code
          svg={codes.pairSvg}
          widthMm={PAIR_CODE_MM}
          ordinal="1"
          label="Scan this first"
          hint="Sets up your phone"
        />
        <Code
          svg={codes.planSvg}
          widthMm={PLAN_CODE_MM}
          ordinal="2"
          label="Then scan this"
          hint="Your exercises"
        />
      </div>

      <p className="plan-sheet__note">{WRONG_ORDER_NOTE}</p>

      {/* No exercise list since 2026-11-05 (owner: "I don't think we need the
          exercise information included in the print out for Cadence. That
          doesn't make any sense anymore."). The codes carry the program, and
          the Tracker prints the full one (decision E2, as amended). */}

      {/* Printed small, for the person issuing it rather than the employee. The
          module size is here so that a code which will not scan at the printer
          can be diagnosed on the spot instead of guessed at afterwards. */}
      <footer className="plan-sheet__foot">
        Key {keyIdHex} · plan {issued.planBytes}/{issued.capacity} bytes ·{' '}
        {codes.planModules} modules at {PLAN_CODE_MM}mm ={' '}
        {codes.planModuleMm.toFixed(2)}mm each
        {!codes.readable && (
          <strong> · BELOW {MIN_MODULE_MM}mm — expect scanning trouble</strong>
        )}
      </footer>
    </section>
  );
}
