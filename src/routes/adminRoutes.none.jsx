/**
 * The admin routes, as the client build sees them: there are none.
 *
 * `vite.config.js` aliases `#admin-routes` here whenever the build variant is
 * not `admin`. Because the alias is resolved at build time, the real
 * `adminRoutes.jsx` -- and everything it imports, including `AdminIssuePlan` and
 * the key-minting `buildPlanQr()` behind it -- is never pulled into the module
 * graph. Not tree-shaken out afterwards: never in.
 *
 * An unknown `/admin` URL therefore falls through to the router's catch-all and
 * lands the visitor on their own page, which is the correct answer for an
 * employee's phone. It does not need to explain itself; on the client build
 * `/admin` is not a page that exists.
 */
const adminRoutes = [];

export default adminRoutes;
