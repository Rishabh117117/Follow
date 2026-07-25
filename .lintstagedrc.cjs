module.exports = {
  '*.{ts,tsx}': (files) => [
    `eslint --fix --max-warnings=0 ${files.map((f) => `"${f}"`).join(' ')}`,
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
  ],
  '*.{js,jsx,json,md,css,yaml,yml}': (files) => [
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
  ],
}
