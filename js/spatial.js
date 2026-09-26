// Siatka przestrzenna (uniform grid) do wyszukiwania sąsiadów w czasie ~O(1).
// Używana przez Layout.ports() (parowanie portów) i checks.js (kandydaci na kolizje).
// Klucze komórek to liczby całkowite ((cx, cy) → jeden klucz), bez tworzenia napisów.

export class SpatialHash {
  /** @param {number} cell rozmiar komórki w mm (≥ promień zapytania, żeby wystarczyły komórki 3×3) */
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  static key(cx, cy) { return (cx + 0x8000) * 0x10000 + (cy + 0x8000); }
  _cell(v) { return Math.floor(v / this.cell); }

  /** Dodaje punkt. */
  add(x, y, item) {
    const k = SpatialHash.key(this._cell(x), this._cell(y));
    const b = this.map.get(k);
    if (b) b.push(item); else this.map.set(k, [item]);
  }
  /** Dodaje prostokąt [x0,y0,x1,y1] do każdej komórki, którą pokrywa. */
  addBox(x0, y0, x1, y1, item) {
    for (let cx = this._cell(x0); cx <= this._cell(x1); cx++) for (let cy = this._cell(y0); cy <= this._cell(y1); cy++) {
      const k = SpatialHash.key(cx, cy);
      const b = this.map.get(k);
      if (b) b.push(item); else this.map.set(k, [item]);
    }
  }
  /** Elementy z komórek 3×3 wokół (x,y). Dla punktów to wszyscy kandydaci w promieniu ≤ cell. */
  near(x, y) {
    const cx = this._cell(x), cy = this._cell(y), out = [];
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const b = this.map.get(SpatialHash.key(i, j));
      if (b) for (const it of b) out.push(it);
    }
    return out;
  }
  /**
   * Pary (i<j) elementów dzielących komórkę – każda para raz. `items` to indeksy dodane przez addBox;
   * wynik przechodzi tylko przez faktycznie zajęte komórki, więc koszt ~ liczba kandydatów, nie n².
   */
  pairs() {
    const seen = new Set(), out = [];
    for (const b of this.map.values()) {
      if (b.length < 2) continue;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
        const a = b[i], c = b[j];
        const k = a < c ? a * 0x100000 + c : c * 0x100000 + a;
        if (seen.has(k)) continue;
        seen.add(k); out.push(a < c ? [a, c] : [c, a]);
      }
    }
    return out;
  }
}
