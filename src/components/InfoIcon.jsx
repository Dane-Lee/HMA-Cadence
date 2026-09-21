/** The ⓘ that DESIGN-RULES rule 2 sends explanations to.
 *
 * *"anything other than the title (or sub-title) should be put into a hoverable
 * 'i' information icon that can pop up for the user to read. otherwise, get that
 * shit off the screen. it's a fuck ton of clutter to deal with."*
 * — the owner, 2026-09-17.
 *
 * The markup and the `.info` / `.tip` styling already existed in `app.css` and
 * on the login card; this is that pattern made reusable rather than retyped,
 * which is what it took to sweep the admin screens on 2026-09-21.
 *
 * `tabIndex={0}` because the tip opens on focus as well as hover: hover alone is
 * unreachable by keyboard and does not exist on a phone, and Cadence is a phone
 * app. `role="tooltip"` plus `aria-label` carries the same words to a screen
 * reader, so the text is never only visual.
 *
 * NOT a licence to keep writing. Rule 2's own note: if a line is not worth a
 * reader opening it, delete it rather than hiding it here.
 */
export default function InfoIcon({ text, label }) {
  if (!text) return null;
  return (
    <span className="info" tabIndex={0} role="tooltip" aria-label={label ?? text}>
      i<span className="tip">{text}</span>
    </span>
  );
}
