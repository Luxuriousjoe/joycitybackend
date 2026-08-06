const assert = require('assert');
const { validateRegistration } = require('../utils/registration_validation');

const valid = validateRegistration({
  name: 'Joy Member',
  email: 'MEMBER@example.com',
  password: 'very-secure-password',
  department: 'media & publicity',
});

assert.deepStrictEqual(valid.value, {
  name: 'Joy Member',
  email: 'member@example.com',
  password: 'very-secure-password',
  department: 'Media & Publicity',
});

assert.match(
  validateRegistration({
    name: 'J',
    email: 'invalid',
    password: 'short',
    department: 'Unknown',
  }).error,
  /Name/,
);

assert.strictEqual(
  validateRegistration({
    name: 'Joy Member',
    email: 'member@example.com',
    password: 'very-secure-password',
  }).value.department,
  'None',
);

console.log('Registration validation tests passed.');
