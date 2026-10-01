// Allowed registration values. Kept in sync with frontend/src/lib/options.js.
// Validation happens here too so the rules cannot be bypassed via the API.

const DEPARTMENTS = ["CSE", "IT", "ECE", "EEE", "CSBS", "AIDS", "MECH"];
const YEARS = ["First Year", "Second Year", "Third Year", "Final Year"];
const SECTIONS = ["A", "B", "C", "D"];

// Case/spacing tolerant match that returns the canonical value, or null.
function normalizeFrom(list, value) {
  const needle = String(value ?? "").trim().toLowerCase();
  if (!needle) return null;
  return list.find((item) => item.toLowerCase() === needle) || null;
}

module.exports = {
  DEPARTMENTS,
  YEARS,
  SECTIONS,
  normalizeDepartment: (v) => normalizeFrom(DEPARTMENTS, v),
  normalizeYear: (v) => normalizeFrom(YEARS, v),
  normalizeSection: (v) => normalizeFrom(SECTIONS, v),
  // Mobile numbers: exactly 10 digits, nothing more, nothing less.
  MOBILE_NUMBER_LENGTH: 10,
  normalizeMobileNumber: (v) => {
    const digits = String(v ?? "").replace(/[^0-9]/g, "");
    return /^[0-9]{10}$/.test(digits) ? digits : null;
  },
};
