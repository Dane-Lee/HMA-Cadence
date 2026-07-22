/**
 * Component-facing data API (facade).
 *
 * Views import these functions; they delegate to whichever backend adapter is
 * selected in ./data/index.js. This indirection is what makes the backend
 * swappable — pages never import a database client. See ./data/contract.js for
 * the shapes each function returns.
 */
import { db } from './data/index.js';

export const fetchActiveProgram      = db.fetchActiveProgram;
export const fetchTodayCheckIn       = db.fetchTodayCheckIn;
export const toggleExerciseComplete  = db.toggleExerciseComplete;
export const endSessionEarly         = db.endSessionEarly;
export const submitFeedback          = db.submitFeedback;
export const reportPain              = db.reportPain;
export const fetchAdminEmployeeList   = db.fetchAdminEmployeeList;
export const fetchUnresolvedPainReports = db.fetchUnresolvedPainReports;
