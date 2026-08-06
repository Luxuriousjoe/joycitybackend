const departments = Object.freeze([
  'None',
  'Welfare',
  'Follow Up & Recovery',
  'Teens & Children',
  'Security',
  'Sanctuary Keepers',
  'Ushering',
  'Protocol',
  'Media & Publicity',
  'Technical & Sound',
  'Choir',
  'Transport & Logistics',
  'Secretariat',
  'Creativity',
]);

function normalizeDepartment(value) {
  const requested = String(value || 'None').trim().toLowerCase();
  return departments.find(
    (department) => department.toLowerCase() === requested,
  );
}

module.exports = { departments, normalizeDepartment };
