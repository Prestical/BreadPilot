// BreadPilot behaviour simulator: chips that talk (M18 18.7d). Plain JavaScript, like solver.mjs, so a
// worker thread now and a browser Web Worker later run the same code.
//
// Each chip answers at the level of its bytes and registers, so the packs' real drivers (sh1106.py,
// ssd1306.py, bme280.py, mpu6050.py, ds3231.py) and the firmware's frozen modules (dht.py, onewire.py,
// ds18x20.py) run unchanged. What a sensor senses comes from the scenario through `sense(key, fallback)`
// (key: the part's ref, or "<ref>.<quantity>" for chips that measure several things). Values not in a
// datasheet in docs/ are marked typical where they are chosen.

// ---------------- helpers ----------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 of a byte array (no Buffer/btoa needed: worker thread or browser). */
export function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

/** Dallas/Maxim CRC-8 (one-wire ROM codes and DS18B20 scratchpads). */
export function crc8(bytes) {
  let crc = 0;
  for (const b of bytes) {
    let x = b;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ x) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      x >>= 1;
    }
  }
  return crc;
}

const bcd = (v) => ((Math.floor(v / 10) << 4) | v % 10) & 0xff;
const fromBcd = (b) => (b >> 4) * 10 + (b & 0x0f);
const clampByte = (v) => Math.max(0, Math.min(255, v)) & 0xff;
const s16 = (v) => {
  const x = Math.max(-32768, Math.min(32767, Math.round(v)));
  return [(x >> 8) & 0xff, x & 0xff];
};

/** A register chip: the first written byte sets the register pointer, more bytes write registers, reads auto-increment. */
class RegisterChip {
  constructor(size = 256) {
    this.regs = new Uint8Array(size);
    this.ptr = 0;
  }
  transfer(write, nread, t, sense) {
    if (write.length) {
      this.ptr = write[0];
      for (let i = 1; i < write.length; i++) this.store(this.ptr++ % this.regs.length, write[i], t, sense);
    }
    if (!nread) return [];
    this.refresh(t, sense);
    const out = [];
    for (let i = 0; i < nread; i++) out.push(this.load(this.ptr++ % this.regs.length, t, sense));
    return out;
  }
  store(reg, value) {
    this.regs[reg] = value;
  }
  load(reg) {
    return this.regs[reg];
  }
  refresh() {}
}

// ---------------- OLED displays ----------------

/** Shared by SH1106 and SSD1306: display RAM in 8 pages and the panel's 128 x 64 picture. */
class Display {
  constructor(columns, offset) {
    this.columns = columns; // RAM columns (SH1106: 132, SSD1306: 128)
    this.offset = offset; // the first RAM column the module's panel shows
    this.ram = new Uint8Array(8 * columns);
    this.page = 0;
    this.col = 0;
    this.on = false;
    this.invert = false;
    this.segRemap = false; // A1: columns left to right as the drivers set them
    this.comReverse = false; // C8
    this.allOn = false;
    this.frameDue = false;
  }
  /** The panel's picture in framebuf's MONO_VLSB layout (128 x 64: 8 pages of 128 bytes). Upright for A1 + C8. */
  picture() {
    const out = new Uint8Array(1024);
    if (!this.on) return out;
    for (let page = 0; page < 8; page++) {
      for (let x = 0; x < 128; x++) {
        const srcX = this.segRemap ? x : 127 - x;
        const srcPage = this.comReverse ? page : 7 - page;
        let byte = this.allOn ? 0xff : this.ram[srcPage * this.columns + this.offset + srcX] ?? 0;
        if (!this.comReverse) byte = reverseBits(byte);
        out[page * 128 + x] = this.invert ? ~byte & 0xff : byte;
      }
    }
    return out;
  }
  takeFrame() {
    const due = this.frameDue;
    this.frameDue = false;
    return due ? this.picture() : null;
  }
}

function reverseBits(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 1 << (7 - i);
  return r;
}

/** SH1106 (Sino Wealth datasheet V2.2, as cited in sh1106.py): control byte 0x00 = commands, 0x40 = RAM data; page addressing. */
class SH1106 extends Display {
  constructor() {
    super(132, 2); // 1.3" modules show RAM columns 2-129 (module fact, see sh1106.py)
  }
  transfer(write) {
    if (!write.length) return [];
    const [control, ...rest] = write;
    if (control === 0x40) {
      for (const b of rest) {
        if (this.col < this.columns) this.ram[this.page * this.columns + this.col] = b;
        this.col++;
      }
      if (this.page === 7) this.frameDue = true;
      return [];
    }
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
      else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
      else if (c >= 0x10 && c <= 0x1f) this.col = ((c & 0x0f) << 4) | (this.col & 0x0f);
      else if (c === 0xae || c === 0xaf) {
        this.on = c === 0xaf;
        this.frameDue = true;
      } else if (c === 0xa0 || c === 0xa1) this.segRemap = c === 0xa1;
      else if (c === 0xc0 || c === 0xc8) this.comReverse = c === 0xc8;
      else if (c === 0xa6 || c === 0xa7) {
        this.invert = c === 0xa7;
        this.frameDue = true;
      } else if (c === 0xa4 || c === 0xa5) this.allOn = c === 0xa5;
      else if ([0x81, 0xa8, 0xad, 0xd3, 0xd5, 0xd9, 0xda, 0xdb].includes(c)) i++; // one argument byte
    }
    return [];
  }
}

/** SSD1306: like the SH1106 plus horizontal/vertical addressing with column and page ranges (21h, 22h). */
class SSD1306 extends Display {
  constructor() {
    super(128, 0);
    this.mode = 2; // page addressing after reset
    this.colRange = [0, 127];
    this.pageRange = [0, 7];
  }
  transfer(write) {
    if (!write.length) return [];
    const [control, ...rest] = write;
    if (control === 0x40) {
      for (const b of rest) {
        this.ram[this.page * 128 + this.col] = b;
        if (this.mode === 0) {
          if (++this.col > this.colRange[1]) {
            this.col = this.colRange[0];
            if (++this.page > this.pageRange[1]) {
              this.page = this.pageRange[0];
              this.frameDue = true;
            }
          }
        } else if (this.mode === 1) {
          if (++this.page > this.pageRange[1]) {
            this.page = this.pageRange[0];
            if (++this.col > this.colRange[1]) {
              this.col = this.colRange[0];
              this.frameDue = true;
            }
          }
        } else if (this.col < 127) this.col++;
      }
      if (this.mode === 2 && this.page === 7) this.frameDue = true;
      return [];
    }
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === 0x20) this.mode = rest[++i] & 3;
      else if (c === 0x21) {
        this.colRange = [rest[i + 1] & 127, rest[i + 2] & 127];
        this.col = this.colRange[0];
        i += 2;
      } else if (c === 0x22) {
        this.pageRange = [rest[i + 1] & 7, rest[i + 2] & 7];
        this.page = this.pageRange[0];
        i += 2;
      } else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
      else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
      else if (c >= 0x10 && c <= 0x1f) this.col = ((c & 0x0f) << 4) | (this.col & 0x0f);
      else if (c === 0xae || c === 0xaf) {
        this.on = c === 0xaf;
        this.frameDue = true;
      } else if (c === 0xa0 || c === 0xa1) this.segRemap = c === 0xa1;
      else if (c === 0xc0 || c === 0xc8) this.comReverse = c === 0xc8;
      else if (c === 0xa6 || c === 0xa7) {
        this.invert = c === 0xa7;
        this.frameDue = true;
      } else if (c === 0xa4 || c === 0xa5) this.allOn = c === 0xa5;
      else if (c === 0x26 || c === 0x27) i += 6;
      else if (c === 0x29 || c === 0x2a) i += 5;
      else if (c === 0xa3) i += 2;
      else if ([0x81, 0x8d, 0xa8, 0xd3, 0xd5, 0xd9, 0xda, 0xdb].includes(c)) i++;
    }
    return [];
  }
}

// ---------------- sensors ----------------

/** BH1750 (no driver: the code writes a mode and reads 2 bytes; lux = raw / 1.2, as in its pack). */
class BH1750 {
  constructor(ref) {
    this.ref = ref;
    this.since = null;
    this.oneTime = false;
  }
  transfer(write, nread, t, sense) {
    for (const c of write) {
      if ([0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(c)) {
        this.since = t;
        this.oneTime = c >= 0x20;
      }
      if (c === 0x00) this.since = null; // power down
    }
    if (!nread) return [];
    // A first measurement takes about 120 ms (H-resolution, typical); before it the result is 0.
    if (this.since === null || t - this.since < 120_000) return new Array(nread).fill(0);
    const raw = Math.max(0, Math.min(65535, Math.round(sense(this.ref, 300) * 1.2)));
    return [(raw >> 8) & 0xff, raw & 0xff].slice(0, nread);
  }
}

/** DS3231: BCD time on the virtual clock (starts 2026-01-01 00:00:00; setting it moves it), temperature in 11h/12h. */
class DS3231 extends RegisterChip {
  constructor(ref) {
    super(0x13);
    this.ref = ref;
    this.base = Date.UTC(2026, 0, 1) / 1000; // its time at t = 0 (an RTC with a coin cell keeps some time)
    this.pending = null;
  }
  store(reg, value, t) {
    this.regs[reg] = value;
    if (reg <= 6) this.pending = t;
  }
  transfer(write, nread, t, sense) {
    const out = super.transfer(write, nread, t, sense);
    if (this.pending !== null && write.length > 1 && write[0] <= 6) {
      // The time registers were written: the clock now runs from the written time.
      const r = this.regs;
      const hours = r[2] & 0x40 ? (fromBcd(r[2] & 0x1f) % 12) + (r[2] & 0x20 ? 12 : 0) : fromBcd(r[2] & 0x3f);
      const set = Date.UTC(2000 + fromBcd(r[6]), fromBcd(r[5] & 0x1f) - 1, fromBcd(r[4] & 0x3f), hours, fromBcd(r[1] & 0x7f), fromBcd(r[0] & 0x7f)) / 1000;
      this.base = set - Math.floor(t / 1_000_000);
      this.weekday = fromBcd(r[3]);
      this.pending = null;
    }
    return out;
  }
  refresh(t, sense) {
    const secs = this.base + Math.floor(t / 1_000_000);
    const d = new Date(secs * 1000);
    const r = this.regs;
    r[0] = bcd(d.getUTCSeconds());
    r[1] = bcd(d.getUTCMinutes());
    r[2] = bcd(d.getUTCHours());
    r[3] = bcd(this.weekday ?? ((d.getUTCDay() + 6) % 7) + 1);
    r[4] = bcd(d.getUTCDate());
    r[5] = bcd(d.getUTCMonth() + 1);
    r[6] = bcd(d.getUTCFullYear() - 2000);
    const temp = Math.round(sense(`${this.ref}.temperature`, 25) * 4) / 4;
    const whole = Math.floor(temp);
    r[0x11] = whole & 0xff;
    r[0x12] = Math.round((temp - whole) * 4) << 6;
  }
}

/** MPU-6050: asleep after power-on (PWR_MGMT_1 = 40h); WHO_AM_I 68h; 14 data bytes from 3Bh at the selected ranges. */
class MPU6050 extends RegisterChip {
  constructor(ref) {
    super(128);
    this.ref = ref;
    this.regs[0x6b] = 0x40;
    this.regs[0x75] = 0x68;
  }
  refresh(t, sense) {
    const asleep = (this.regs[0x6b] & 0x40) !== 0;
    const aScale = 16384 / (1 << ((this.regs[0x1c] >> 3) & 3));
    const gScale = 131 / (1 << ((this.regs[0x1b] >> 3) & 3));
    const v = (q, d) => sense(`${this.ref}.${q}`, d);
    const data = asleep
      ? new Array(14).fill(0)
      : [
          ...s16(v("ax", 0) * aScale),
          ...s16(v("ay", 0) * aScale),
          ...s16(v("az", 1) * aScale),
          ...s16((v("temperature", 25) - 36.53) * 340),
          ...s16(v("gx", 0) * gScale),
          ...s16(v("gy", 0) * gScale),
          ...s16(v("gz", 0) * gScale),
        ];
    this.regs.set(data, 0x3b);
  }
}

/**
 * BME280 (BMP280 compatible): chip id 60h; calibration in 88h-A1h and E1h-E7h; raw data from F7h.
 * Calibration: the BMP280 datasheet's example values for T and P, typical BME280 values for H (not
 * from a page in docs/). Raw readings are chosen so the driver's own formulas give the sensed values.
 */
const CAL = { T: [27504, 26435, -1000], P: [36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000], H: [75, 362, 0, 324, 0, 30] };

function bmeTemp(adcT) {
  const [T1, T2, T3] = CAL.T;
  const v1 = (adcT / 16384 - T1 / 1024) * T2;
  const v2 = (adcT / 131072 - T1 / 8192) ** 2 * T3;
  return v1 + v2; // t_fine
}
function bmePress(adcP, tFine) {
  const [P1, P2, P3, P4, P5, P6, P7, P8, P9] = CAL.P;
  let v1 = tFine / 2 - 64000;
  let v2 = (v1 * v1 * P6) / 32768 + v1 * P5 * 2;
  v2 = v2 / 4 + P4 * 65536;
  v1 = ((P3 * v1 * v1) / 524288 + P2 * v1) / 524288;
  v1 = (1 + v1 / 32768) * P1;
  let p = 1048576 - adcP;
  p = ((p - v2 / 4096) * 6250) / v1;
  return (p + ((P9 * p * p) / 2147483648 + (p * P8) / 32768 + P7) / 16) / 100;
}
function bmeHum(adcH, tFine) {
  const [H1, H2, H3, H4, H5, H6] = CAL.H;
  let h = tFine - 76800;
  h = (adcH - (H4 * 64 + (H5 / 16384) * h)) * ((H2 / 65536) * (1 + (H6 / 67108864) * h * (1 + (H3 / 67108864) * h)));
  return h * (1 - (H1 * h) / 524288);
}
/** The integer in [lo, hi] where f crosses target (f monotonic). */
function solveFor(f, target, lo, hi) {
  const rising = f(hi) > f(lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return Math.abs(f(lo) - target) <= Math.abs(f(hi) - target) ? lo : hi;
}

class BME280 extends RegisterChip {
  constructor(ref) {
    super(256);
    this.ref = ref;
    const r = this.regs;
    r[0xd0] = 0x60;
    const put16 = (at, v) => {
      const x = v & 0xffff;
      r[at] = x & 0xff;
      r[at + 1] = x >> 8;
    };
    CAL.T.forEach((v, i) => put16(0x88 + 2 * i, v));
    CAL.P.forEach((v, i) => put16(0x8e + 2 * i, v));
    const [H1, H2, H3, H4, H5, H6] = CAL.H;
    r[0xa1] = H1;
    put16(0xe1, H2);
    r[0xe3] = H3;
    r[0xe4] = (H4 >> 4) & 0xff;
    r[0xe5] = (H4 & 0x0f) | ((H5 & 0x0f) << 4);
    r[0xe6] = (H5 >> 4) & 0xff;
    r[0xe7] = H6 & 0xff;
    // Data registers after reset (no measurement yet): 80000h for P and T, 8000h for H.
    r.set([0x80, 0, 0, 0x80, 0, 0, 0x80, 0], 0xf7);
  }
  refresh(t, sense) {
    if ((this.regs[0xf4] & 3) === 0) return; // sleep mode: no new measurement
    const T = sense(`${this.ref}.temperature`, 22);
    const P = sense(`${this.ref}.pressure`, 1013.25);
    const H = sense(`${this.ref}.humidity`, 45);
    const adcT = solveFor((x) => bmeTemp(x) / 5120, T, 0, (1 << 20) - 1);
    const tFine = bmeTemp(adcT);
    const adcP = solveFor((x) => bmePress(x, tFine), P, 0, (1 << 20) - 1);
    const adcH = solveFor((x) => Math.min(100, Math.max(0, bmeHum(x, tFine))), H, 0, 65535);
    this.regs.set([adcP >> 12, (adcP >> 4) & 0xff, (adcP & 0xf) << 4, adcT >> 12, (adcT >> 4) & 0xff, (adcT & 0xf) << 4, adcH >> 8, adcH & 0xff], 0xf7);
  }
}

export function makeI2CChip(type, ref) {
  switch (type) {
    case "oled-sh1106-i2c":
      return new SH1106();
    case "oled-ssd1306-i2c":
      return new SSD1306();
    case "light-sensor-bh1750":
      return new BH1750(ref);
    case "rtc-ds3231":
      return new DS3231(ref);
    case "mpu6050":
      return new MPU6050(ref);
    case "bme280":
      return new BME280(ref);
    default:
      return null;
  }
}

// ---------------- one wire: DHT11/22 and DS18B20 ----------------

/**
 * The 5 bytes rp2.dht_readinto fills, or null when the sensor doesn't answer: in the first second
 * after power-up (DHT11 manual p.6; the pack's startupWaitS).
 */
export function dhtBytes(type, ref, t, sense, startupUs = 1_000_000) {
  if (t < startupUs) return null;
  const temp = sense(`${ref}.temperature`, 22);
  const hum = sense(`${ref}.humidity`, 45);
  let b;
  if (type === "dht11") {
    const tt = Math.round(temp * 10);
    b = [Math.round(hum), 0, Math.floor(tt / 10) & 0xff, Math.abs(tt % 10), 0];
  } else {
    const h = Math.round(hum * 10);
    const tt = Math.round(Math.abs(temp) * 10) | (temp < 0 ? 0x8000 : 0);
    b = [h >> 8, h & 0xff, (tt >> 8) & 0xff, tt & 0xff, 0];
  }
  b[4] = (b[0] + b[1] + b[2] + b[3]) & 0xff;
  return b;
}

/** A DS18B20 on a one-wire line: ROM code, scratchpad (85 °C until a conversion ends), 750 ms conversions. */
export class DS18B20 {
  constructor(ref) {
    this.ref = ref;
    let h = 0;
    for (const ch of ref) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rom = [0x28, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, (h >> 24) & 0xff, 0x01, 0x00];
    this.rom = [...rom, crc8(rom)];
    this.tempRaw = 0x0550; // power-on value: 85 °C
    this.convertDone = null;
    this.th = 0x4b;
    this.tl = 0x46;
    this.config = 0x7f;
  }
  update(t, sense) {
    if (this.convertDone !== null && t >= this.convertDone) {
      this.tempRaw = Math.round(sense(`${this.ref}.temperature`, sense(this.ref, 22)) * 16) & 0xffff;
      this.convertDone = null;
    }
  }
  scratchpad() {
    const s = [this.tempRaw & 0xff, (this.tempRaw >> 8) & 0xff, this.th, this.tl, this.config, 0xff, 0x0c, 0x10];
    return [...s, crc8(s)];
  }
}

/** One one-wire line (a GPIO) with its devices, following the ROM and function commands. */
export class OneWireBus {
  constructor(devices) {
    this.devices = devices;
    this.phase = "idle";
  }
  reset(t, sense) {
    for (const d of this.devices) d.update(t, sense);
    this.phase = "rom";
    this.selected = [];
    this.reading = [];
    this.matching = null;
    return this.devices.length > 0 ? 1 : 0;
  }
  writeByte(b, t, sense) {
    for (const d of this.devices) d.update(t, sense);
    if (this.phase === "match") {
      this.matching.push(b);
      if (this.matching.length === 8) {
        this.selected = this.devices.filter((d) => d.rom.every((x, i) => x === this.matching[i]));
        this.phase = "func";
      }
      return;
    }
    if (this.phase === "rom") {
      if (b === 0xcc) (this.selected = [...this.devices]), (this.phase = "func");
      else if (b === 0x55) (this.matching = []), (this.phase = "match");
      else if (b === 0x33 && this.devices.length === 1) (this.selected = [...this.devices]), (this.reading = [...this.devices[0].rom]), (this.phase = "func");
      else if (b === 0xf0) (this.search = { active: [...this.devices], bit: 0, step: 0 }), (this.phase = "search");
      return;
    }
    if (this.phase === "func") {
      if (b === 0x44) for (const d of this.selected) d.convertDone = t + 750_000;
      else if (b === 0xbe && this.selected.length === 1) this.reading = this.selected[0].scratchpad();
      else if (b === 0x4e) this.phase = "write";
      return;
    }
  }
  readByte(t, sense) {
    for (const d of this.devices) d.update(t, sense);
    return this.reading.length ? this.reading.shift() : 0xff;
  }
  readBit(t, sense) {
    for (const d of this.devices) d.update(t, sense);
    if (this.phase === "search") {
      const s = this.search;
      const bitOf = (d) => (d.rom[s.bit >> 3] >> (s.bit & 7)) & 1;
      const value = s.step === 0 ? s.active.every((d) => bitOf(d)) : s.active.every((d) => !bitOf(d));
      s.step++;
      return value ? 1 : 0;
    }
    // Outside a search: a converting DS18B20 holds the line low (read 0) until it is done.
    return this.selected?.some((d) => d.convertDone !== null) ? 0 : 1;
  }
  writeBit(v) {
    if (this.phase === "search") {
      const s = this.search;
      s.active = s.active.filter((d) => ((d.rom[s.bit >> 3] >> (s.bit & 7)) & 1) === (v ? 1 : 0));
      s.bit++;
      s.step = 0;
      if (s.bit === 64) (this.phase = "func"), (this.selected = s.active);
    }
  }
}
