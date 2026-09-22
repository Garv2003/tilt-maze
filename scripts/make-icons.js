/**
 * Generates the app icons from the game's own visual language: a black tray,
 * a white extruded frame, two wall blocks and the marble.
 *
 * Written against zlib directly rather than pulling in an image library - the
 * shapes are signed-distance fields, so everything is antialiased for free.
 *
 *   node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG output

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

const crc32 = buf => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ------------------------------------------------------------ shape distance

/** Signed distance to a rounded rect centred on (cx, cy). */
const sdRoundRect = (px, py, cx, cy, halfW, halfH, r) => {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
};

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

/** 1 inside, 0 outside, smoothly crossing over roughly one pixel. */
const coverage = d => Math.min(1, Math.max(0, 0.5 - d));

const draw = (size, shapes) => {
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      let value = 0; // 0 = black, 1 = white
      let alpha = 0;

      shapes.forEach(shape => {
        const c = coverage(shape.distance(px, py));
        if (c <= 0) {
          return;
        }
        value = value * (1 - c) + shape.white * c;
        alpha = alpha + (1 - alpha) * c;
      });

      const i = (y * size + x) * 4;
      const level = Math.round(value * 255);
      rgba[i] = level;
      rgba[i + 1] = level;
      rgba[i + 2] = level;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return rgba;
};

/**
 * The mark: a frame with a hollow middle, two blocks, and the marble sitting
 * high-left the way the light falls in the game.
 */
const markShapes = (size, { scale = 1, background = true } = {}) => {
  const c = size / 2;
  const s = v => v * size * scale;
  const shapes = [];

  if (background) {
    shapes.push({
      white: 0,
      distance: (x, y) =>
        sdRoundRect(x, y, c, c, size / 2, size / 2, size * 0.22),
    });
  }

  // Frame: a white rounded rect with the tray knocked out of it.
  shapes.push({
    white: 1,
    distance: (x, y) => sdRoundRect(x, y, c, c, s(0.36), s(0.42), s(0.1)),
  });
  shapes.push({
    white: 0,
    distance: (x, y) => sdRoundRect(x, y, c, c, s(0.3), s(0.36), s(0.06)),
  });

  // Two wall blocks, echoing a maze.
  shapes.push({
    white: 1,
    distance: (x, y) =>
      sdRoundRect(x, y - s(0.1), c + s(0.05), c, s(0.17), s(0.042), s(0.02)),
  });
  shapes.push({
    white: 1,
    distance: (x, y) =>
      sdRoundRect(x, y + s(0.1), c - s(0.05), c, s(0.15), s(0.042), s(0.02)),
  });

  // The marble, clear of the blocks so it still reads as a ball.
  shapes.push({
    white: 1,
    distance: (x, y) => sdCircle(x, y, c - s(0.17), c - s(0.255), s(0.058)),
  });

  // The goal ring, bottom-right, where the run ends.
  shapes.push({
    white: 1,
    distance: (x, y) => sdCircle(x, y, c + s(0.165), c + s(0.245), s(0.075)),
  });
  shapes.push({
    white: 0,
    distance: (x, y) => sdCircle(x, y, c + s(0.165), c + s(0.245), s(0.042)),
  });

  return shapes;
};

const outDir = path.join(__dirname, '..', 'assets');

const write = (name, size, shapes) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, encodePng(size, size, draw(size, shapes)));
  const { size: bytes } = fs.statSync(file);
  console.log(
    `${name.padEnd(20)} ${size}x${size}  ${(bytes / 1024).toFixed(1)} KB`,
  );
};

write('icon.png', 1024, markShapes(1024));
// Android masks the adaptive foreground, so the mark sits inside the safe zone.
write(
  'adaptive-icon.png',
  1024,
  markShapes(1024, { scale: 0.62, background: false }),
);
write('splash.png', 1024, markShapes(1024, { scale: 0.42, background: false }));
write('favicon.png', 64, markShapes(64));
