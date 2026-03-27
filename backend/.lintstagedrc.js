module.exports = {
  // Lint only staged TS/TSX files (lint-staged appends the filenames automatically).
  '**/*.{ts,tsx}': ['npm --prefix backend exec -- eslint --fix'],
  // Run full backend suite (do not pass staged filenames).
  '**/*': () => 'npm test',
}

