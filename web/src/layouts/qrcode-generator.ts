// Minimal QR encoder — alphanumeric-mode only, error level "M",
// version auto-selected for our 12-char canonical IDs.
//
// Adapted (and trimmed) from kazuhikoarase/qrcode-generator (MIT).
// Only includes the code paths we actually exercise:
//   - alphanumeric mode (sufficient since our alphabet is 0-9 A-Z subset)
//   - Reed-Solomon error correction at level M
//   - Auto-type from version 1 upward
//
// This replaces a direct dep just to keep the spike's bundle small.
// If the test suite ever flags drift vs Python segno, swap in a full
// library (e.g. `qrcode` npm package) or load segno via Pyodide.

const PAD0 = 0xec;
const PAD1 = 0x11;

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

interface QRCodeApi {
  addData(s: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(r: number, c: number): boolean;
}

export default function qrcode(typeNumber: 0 | number, errorLevel: "L" | "M" | "Q" | "H"): QRCodeApi {
  let dataList: string[] = [];
  let modules: boolean[][] = [];
  let moduleCount = 0;
  let chosenType = typeNumber;
  const ec = errorCorrectionLevel(errorLevel);

  function addData(data: string): void {
    dataList.push(data);
  }

  function make(): void {
    if (chosenType < 1) {
      chosenType = pickType(dataList.join(""), ec);
    }
    makeImpl(false, getBestMaskPattern());
  }

  function makeImpl(test: boolean, maskPattern: number): void {
    moduleCount = chosenType * 4 + 17;
    modules = makeArray(moduleCount, () => makeArray<boolean>(moduleCount, () => false));

    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(moduleCount - 7, 0);
    setupPositionProbePattern(0, moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (chosenType >= 7) setupTypeNumber(test);

    const data = createData(chosenType, ec, dataList);
    mapData(data, maskPattern);
  }

  function setupPositionProbePattern(row: number, col: number): void {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r <= -1 || moduleCount <= row + r || col + c <= -1 || moduleCount <= col + c) continue;
        const dark =
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4);
        modules[row + r][col + c] = dark;
      }
    }
  }

  function setupPositionAdjustPattern(): void {
    const pos = patternPositionTable[chosenType - 1];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i], col = pos[j];
        if (modules[row][col] !== false) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            modules[row + r][col + c] =
              r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
  }

  function setupTimingPattern(): void {
    for (let r = 8; r < moduleCount - 8; r++) {
      if (modules[r][6] !== false) continue;
      modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < moduleCount - 8; c++) {
      if (modules[6][c] !== false) continue;
      modules[6][c] = c % 2 === 0;
    }
  }

  function setupTypeInfo(test: boolean, mask: number): void {
    const data = (ec << 3) | mask;
    const bits = bchTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) modules[i][8] = mod;
      else if (i < 8) modules[i + 1][8] = mod;
      else modules[moduleCount - 15 + i][8] = mod;
    }
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) modules[8][moduleCount - i - 1] = mod;
      else if (i < 9) modules[8][15 - i - 1 + 1] = mod;
      else modules[8][15 - i - 1] = mod;
    }
    modules[moduleCount - 8][8] = !test;
  }

  function setupTypeNumber(test: boolean): void {
    const bits = bchTypeNumber(chosenType);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      modules[Math.floor(i / 3)][(i % 3) + moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      modules[(i % 3) + moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  function mapData(data: number[], mask: number): void {
    let inc = -1;
    let row = moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    for (let col = moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (modules[row][col - c] === undefined || (modules[row][col - c] as unknown) !== false) {
            // already set
          }
          if ((modules[row][col - c] as unknown) === false) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            const m = maskFn(mask, row, col - c);
            if (m) dark = !dark;
            modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  function getBestMaskPattern(): number {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i++) {
      makeImpl(true, i);
      const lostPoint = getLostPoint(modules);
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  function getModuleCount(): number {
    return moduleCount;
  }

  function isDark(r: number, c: number): boolean {
    if (r < 0 || moduleCount <= r || c < 0 || moduleCount <= c) {
      throw new Error(`${r},${c}`);
    }
    return modules[r][c] === true;
  }

  return { addData, make, getModuleCount, isDark };
}

// --------- helpers / tables ---------

function makeArray<T>(n: number, fn: () => T): T[] {
  const a = new Array<T>(n);
  for (let i = 0; i < n; i++) a[i] = fn();
  return a;
}

function errorCorrectionLevel(s: "L" | "M" | "Q" | "H"): number {
  return { L: 1, M: 0, Q: 3, H: 2 }[s];
}

function pickType(data: string, ec: number): number {
  // Alphanumeric mode capacity tables (chars per version, error level M).
  const cap = [
    20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656,
    734, 816, 909, 970, 1035, 1134, 1248, 1326, 1451, 1542, 1637, 1732, 1839, 1994,
    2113, 2238, 2369, 2506, 2632, 2780, 2894, 3054, 3220, 3391,
  ];
  for (let i = 0; i < cap.length; i++) if (data.length <= cap[i]) return i + 1;
  throw new Error("data too long");
  // ec used to disambiguate — only M used in this codebase, kept for API.
  void ec;
}

function bchTypeInfo(data: number): number {
  let d = data << 10;
  while (bchDigit(d) - bchDigit(0x537) >= 0) {
    d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
  }
  return ((data << 10) | d) ^ 0x5412;
}

function bchTypeNumber(data: number): number {
  let d = data << 12;
  while (bchDigit(d) - bchDigit(0x1f25) >= 0) {
    d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
  }
  return (data << 12) | d;
}

function bchDigit(n: number): number {
  let d = 0;
  while (n !== 0) {
    d++;
    n >>>= 1;
  }
  return d;
}

const patternPositionTable = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function maskFn(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default: throw new Error("bad mask " + mask);
  }
}

function getLostPoint(mods: boolean[][]): number {
  const n = mods.length;
  let lost = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n - 6; c++) {
      if (mods[r][c] === mods[r][c + 1]) lost++;
    }
  }
  return lost;
}

function createData(typeNumber: number, ec: number, dataList: string[]): number[] {
  const buffer = new BitBuffer();
  for (const data of dataList) {
    buffer.put(0x2, 4); // alphanumeric mode indicator
    buffer.put(data.length, lengthInBits(typeNumber));
    writeAlphanumeric(buffer, data);
  }
  const totalDataCount = totalDataCountFor(typeNumber, ec);
  if (buffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error(
      `code length overflow (${buffer.getLengthInBits()}>${totalDataCount * 8})`,
    );
  }
  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
  while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
  while (true) {
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(PAD0, 8);
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(PAD1, 8);
  }
  return createBytes(buffer, typeNumber, ec);
}

function lengthInBits(typeNumber: number): number {
  if (typeNumber < 10) return 9;
  if (typeNumber < 27) return 11;
  return 13;
}

function writeAlphanumeric(buffer: BitBuffer, data: string): void {
  for (let i = 0; i < data.length; i += 2) {
    if (i + 1 < data.length) {
      buffer.put(45 * ALPHANUMERIC.indexOf(data[i]) + ALPHANUMERIC.indexOf(data[i + 1]), 11);
    } else {
      buffer.put(ALPHANUMERIC.indexOf(data[i]), 6);
    }
  }
}

class BitBuffer {
  buffer: number[] = [];
  length = 0;
  putBit(bit: boolean): void {
    const buf = Math.floor(this.length / 8);
    if (this.buffer.length <= buf) this.buffer.push(0);
    if (bit) this.buffer[buf] |= 0x80 >>> this.length % 8;
    this.length++;
  }
  put(num: number, len: number): void {
    for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1);
  }
  getLengthInBits(): number {
    return this.length;
  }
}

// --- Reed-Solomon block tables for type 1-10, level M ---
// Each entry: [totalCount, dataCount] per block, plus number of blocks of each.
// Trimmed to versions 1-10 since 12 alphanumeric chars fits in version 1.
const rsBlockTable: Record<string, number[][]> = {
  "1M": [[1, 26, 16]],
  "2M": [[1, 44, 28]],
  "3M": [[1, 70, 44]],
  "4M": [[2, 50, 32]],
  "5M": [[2, 67, 43]],
  "6M": [[4, 43, 27]],
  "7M": [[4, 49, 31]],
  "8M": [[2, 60, 38], [2, 61, 39]],
  "9M": [[3, 58, 36], [2, 59, 37]],
  "10M": [[4, 69, 43], [1, 70, 44]],
};

const ecLabels = ["M", "L", "H", "Q"];

function totalDataCountFor(typeNumber: number, ec: number): number {
  const blocks = rsBlocks(typeNumber, ec);
  let total = 0;
  for (const b of blocks) total += b.dataCount;
  return total;
}

interface RSBlock {
  totalCount: number;
  dataCount: number;
}

function rsBlocks(typeNumber: number, ec: number): RSBlock[] {
  const key = `${typeNumber}${ecLabels[ec]}`;
  const tbl = rsBlockTable[key];
  if (!tbl) throw new Error(`no RS table for ${key}`);
  const out: RSBlock[] = [];
  for (const [count, totalCount, dataCount] of tbl) {
    for (let i = 0; i < count; i++) out.push({ totalCount, dataCount });
  }
  return out;
}

function createBytes(buffer: BitBuffer, typeNumber: number, ec: number): number[] {
  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const rsBlocksArr = rsBlocks(typeNumber, ec);
  const dcdata: number[][] = [];
  const ecdata: number[][] = [];
  for (const block of rsBlocksArr) {
    const dcCount = block.dataCount;
    const ecCount = block.totalCount - block.dataCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    const dc = new Array<number>(dcCount);
    for (let i = 0; i < dc.length; i++) dc[i] = 0xff & buffer.buffer[i + offset];
    offset += dcCount;
    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new Polynomial(dc, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ecArr = new Array<number>(rsPoly.getLength() - 1);
    for (let i = 0; i < ecArr.length; i++) {
      const modIndex = i + modPoly.getLength() - ecArr.length;
      ecArr[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
    dcdata.push(dc);
    ecdata.push(ecArr);
  }
  let totalCodeCount = 0;
  for (const block of rsBlocksArr) totalCodeCount += block.totalCount;
  const data = new Array<number>(totalCodeCount);
  let index = 0;
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocksArr.length; r++) {
      if (i < dcdata[r].length) data[index++] = dcdata[r][i];
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocksArr.length; r++) {
      if (i < ecdata[r].length) data[index++] = ecdata[r][i];
    }
  }
  return data;
}

function getErrorCorrectPolynomial(ecLength: number): Polynomial {
  let a = new Polynomial([1], 0);
  for (let i = 0; i < ecLength; i++) a = a.multiply(new Polynomial([1, gexp(i)], 0));
  return a;
}

class Polynomial {
  num: number[];
  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array<number>(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  }
  get(i: number): number {
    return this.num[i];
  }
  getLength(): number {
    return this.num.length;
  }
  multiply(e: Polynomial): Polynomial {
    const num = new Array<number>(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new Polynomial(num, 0);
  }
  mod(e: Polynomial): Polynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = this.num.slice();
    for (let i = 0; i < e.getLength(); i++) num[i] ^= gexp(glog(e.get(i)) + ratio);
    return new Polynomial(num, 0).mod(e);
  }
}

const EXP_TABLE: number[] = new Array(256);
const LOG_TABLE: number[] = new Array(256);
(function initTables() {
  for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;
})();

function glog(n: number): number {
  if (n < 1) throw new Error("glog " + n);
  return LOG_TABLE[n];
}

function gexp(n: number): number {
  while (n < 0) n += 255;
  while (n >= 256) n -= 255;
  return EXP_TABLE[n];
}
