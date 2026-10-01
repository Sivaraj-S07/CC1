// Single source of truth for the student registration dropdowns.
// The backend validates against the exact same lists (backend/src/utils/enums.js)
// so arbitrary values can never be submitted through the API.

export const DEPARTMENTS = ["CSE", "IT", "ECE", "EEE", "CSBS", "AIDS", "MECH"];

export const YEARS = ["First Year", "Second Year", "Third Year", "Final Year"];

export const SECTIONS = ["A", "B", "C", "D"];
