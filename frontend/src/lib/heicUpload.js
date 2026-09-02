function looksLikeHeic(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.hei[cf]$/.test(name);
}

async function hasHeicMagic(file) {
  try {
    const buf = await file.slice(4, 12).arrayBuffer();
    const ascii = new TextDecoder().decode(buf);
    return ascii.startsWith('ftyp') && /heic|heix|heif|heis|heim|mif1|msf1/i.test(ascii.slice(4));
  } catch {
    return false;
  }
}

function jpegFile(blob, original) {
  const name = String(original?.name || 'photo');
  const base = name.replace(/\.hei[cf]$/i, '') || 'photo';
  const filename = /\.jpe?g$/i.test(base) ? base : `${base}.jpg`;
  return new File([blob], filename, {
    type: 'image/jpeg',
    lastModified: original?.lastModified || Date.now(),
  });
}

async function heicToJpegBlob(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode JPEG'))), 'image/jpeg', 0.92);
    });
    return blob;
  } catch {
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  }
}

/** Convert iPhone HEIC stills to JPEG so Chrome can display them and vision can analyse them. */
export async function fileForUpload(file) {
  if (!file || String(file.type || '').startsWith('video/')) return file;
  const heic = looksLikeHeic(file) || await hasHeicMagic(file);
  if (!heic) return file;
  try {
    return jpegFile(await heicToJpegBlob(file), file);
  } catch (err) {
    console.warn('[upload] HEIC convert failed, uploading original', err);
    return file;
  }
}

export async function filesForUpload(files) {
  return Promise.all([...files].map(fileForUpload));
}
