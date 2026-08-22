const encoder = new TextEncoder();

function pad(n) {
  return String(n).padStart(2, '0');
}

export function folderStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function safeFileSegment(value, fallback = 'entry') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function extFor(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* fall through */
    }
  }
  return 'txt';
}

function fileText(text) {
  return String(text || '');
}

/** Build input/ and output/ files — one pair per debug entry, same basename. */
export function debugEntriesToFiles(entries) {
  const files = [];
  (Array.isArray(entries) ? entries : []).forEach((entry, i) => {
    const n = pad(i + 1);
    const name = safeFileSegment(entry.source, `entry-${n}`);
    const inputParts = [];
    if (String(entry.systemPrompt || '').trim()) {
      inputParts.push('=== SYSTEM ===', String(entry.systemPrompt), '', '=== INPUT ===');
    }
    inputParts.push(fileText(entry.prompt));
    const input = inputParts.join('\n');
    const output = fileText(entry.output);
    files.push({ path: `input/${n}-${name}.${extFor(entry.prompt)}`, text: input });
    files.push({ path: `output/${n}-${name}.${extFor(entry.output)}`, text: output });
  });
  return files;
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
}

/** Store-only ZIP (no compression) so we can download a folder without a library. */
export function buildZipBlob(files) {
  const { time, day } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path);
    const data = encoder.encode(file.text ?? '');
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    locals.push(local);
    centrals.push(concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(day),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]));
    offset += local.length;
  });

  const central = concatBytes(centrals);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);

  return new Blob([concatBytes([...locals, central, end])], { type: 'application/zip' });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function writeFilesToDirectory(root, files) {
  for (const file of files) {
    const parts = String(file.path || '').split('/').filter(Boolean);
    if (!parts.length) continue;
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.text ?? '');
    await writable.close();
  }
}

/**
 * Save files as input/ and output/ in a real folder when the browser allows it.
 * Otherwise download a zip with the same layout.
 */
export async function downloadFilesAsFolder(files, folderName) {
  const name = safeFileSegment(folderName, `ai-prompt-debug-${folderStamp()}`);
  if (!files.length) return 'empty';

  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const dest = await window.showDirectoryPicker({
        id: 'ai-prompt-debug',
        mode: 'readwrite',
        startIn: 'downloads',
      });
      const bundle = await dest.getDirectoryHandle(name, { create: true });
      await writeFilesToDirectory(bundle, files);
      return 'folder';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  triggerDownload(buildZipBlob(files), `${name}.zip`);
  return 'zip';
}
