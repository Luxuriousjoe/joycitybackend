// Keep registration's allowed values self-contained so the public auth route
// cannot fail to boot if a deployment omits an auxiliary config file.
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

function validateRegistration(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string'
    ? input.email.trim().toLowerCase()
    : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const department = normalizeDepartment(input.department);

  if (name.length < 2 || name.length > 100) {
    return { error: 'Name must contain between 2 and 100 characters.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
    return { error: 'Enter a valid email address.' };
  }

  if (password.length < 12 || password.length > 128) {
    return { error: 'Password must contain between 12 and 128 characters.' };
  }

  if (!department) {
    return { error: 'Select a valid department.' };
  }

  return { value: { name, email, password, department } };
}

module.exports = { validateRegistration };
