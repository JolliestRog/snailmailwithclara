import { createHash, randomBytes } from 'node:crypto';

const username = (process.argv[2] || 'clara').toLowerCase();
if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username)) {
  throw new Error('Pass Clara\'s intended username: npm run bootstrap -- clara');
}
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('base64url');

console.log(`\nClara bootstrap username: ${username}`);
console.log(`Clara bootstrap invitation: https://snailmailwithclara.facey.page/join?invite=${token}`);
console.log(`\nStore these Worker secrets (the raw invitation is not stored):`);
console.log(`BOOTSTRAP_USERNAME=${username}`);
console.log(`BOOTSTRAP_TOKEN_HASH=${hash}`);
console.log('\nThe invitation expires operationally when it is used; the Worker rejects every later attempt.');
