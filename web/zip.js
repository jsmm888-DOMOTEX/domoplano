// Lector mínimo de ZIP (stored + deflate) sin dependencias.
// Tolera datos antes del zip (los DWF 6 empiezan con "(DWF V06.00)").
const Zip = (() => {
  const td = new TextDecoder('utf-8');
  const tdLatin = new TextDecoder('latin1');

  function findEOCD(u8) {
    const min = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= min; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    return -1;
  }

  async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function normalize(name) {
    return name.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function open(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const eocd = findEOCD(u8);
    if (eocd < 0) throw new Error('No es un archivo ZIP/DWF válido (no se encontró el directorio central).');
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    // Si hay datos antepuestos (cabecera DWF), los offsets vienen corridos.
    const delta = (eocd - cdSize) - cdOff;
    cdOff += delta;
    const entries = new Map();
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true) + delta;
      const raw = u8.subarray(p + 46, p + 46 + nlen);
      const name = normalize((flags & 0x800) ? td.decode(raw) : tdLatin.decode(raw));
      entries.set(name.toLowerCase(), { name, method, csize, usize, lho });
      p += 46 + nlen + xlen + clen;
    }

    async function read(name) {
      const e = entries.get(normalize(name).toLowerCase());
      if (!e) return null;
      const n = dv.getUint16(e.lho + 26, true);
      const x = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + n + x;
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error('Método de compresión no soportado: ' + e.method);
    }
    async function text(name) {
      const d = await read(name);
      return d ? td.decode(d) : null;
    }
    return {
      names: () => [...entries.values()].map(e => e.name),
      has: (name) => entries.has(normalize(name).toLowerCase()),
      read, text,
    };
  }

  return { open, inflateRaw };
})();
if (typeof module !== 'undefined') module.exports = Zip; else self.Zip = Zip;
