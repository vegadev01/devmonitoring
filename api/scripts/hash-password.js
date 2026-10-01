// Usage: node api/scripts/hash-password.js "your-password"
// Prints the bcrypt hash, plus the "$$"-escaped form for use in .env with docker-compose.
const bcrypt = require("bcryptjs");
const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node api/scripts/hash-password.js "your-password"');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log("Hash:             " + hash);
console.log("Escaped for .env: " + hash.replace(/\$/g, "$$$$"));
