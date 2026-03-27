module.exports = {
  // Run full frontend suite (do not pass staged filenames).
  'frontend/**/*.{ts,tsx}': () => 'npm --prefix frontend test',
}

