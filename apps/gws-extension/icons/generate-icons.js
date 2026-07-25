// Generate simple placeholder PNG icons using Canvas API
// This creates minimal "F" icons at required sizes
const fs = require('fs');
const { createCanvas } = require('canvas');

const sizes = [16, 32, 48, 128];

// Since we may not have the canvas module, create SVG-based placeholders
// that Chrome can still load (Chrome accepts PNG, we'll create minimal valid PNGs)

// Actually, let's create minimal valid PNG files
// A 1x1 purple pixel as a placeholder
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

// For simplicity, create SVGs and note they need conversion
sizes.forEach(size => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="#6366F1"/>
  <text x="${size/2}" y="${size * 0.68}" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="${Math.round(size * 0.55)}">F</text>
</svg>`;
  fs.writeFileSync(`icons/icon${size}.svg`, svg);
  console.log(`Created icon${size}.svg`);
});
