export interface TreemapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Splits a width × height space into one box per value, each in proportion to its share and as close to square as the
 * shares allow (Bruls, Huizing and van Wijk's squarified treemap).
 *
 * The largest values are laid first, a row at a time along the shorter side, and a value joins the row only while it
 * makes the row's worst box no worse. The boxes come back in the order the values were given, so a caller can zip them
 * with what it asked about — which is why the values are expected above nought: a share of nothing has no box, and the
 * caller leaves it out before asking. Nothing to share is nothing drawn.
 */
export function squarify(values: readonly number[], width: number, height: number): TreemapBox[] {
  if (values.length === 0 || values.some((value) => !(value > 0))) return [];
  const whole = values.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, area: (value / whole) * width * height }))
    .sort((a, b) => b.area - a.area || a.index - b.index);
  const boxes: TreemapBox[] = new Array(values.length);

  /** How far from square a row's worst box is, laid along a side of this length. */
  const worst = (row: readonly { area: number }[], side: number) => {
    const sum = row.reduce((total, item) => total + item.area, 0);
    const largest = Math.max(...row.map((item) => item.area));
    const smallest = Math.min(...row.map((item) => item.area));
    return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
  };

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let next = 0;
  while (next < order.length) {
    const side = Math.min(w, h);
    const row = [order[next]!];
    next += 1;
    while (next < order.length && worst([...row, order[next]!], side) <= worst(row, side)) {
      row.push(order[next]!);
      next += 1;
    }
    const sum = row.reduce((total, item) => total + item.area, 0);
    if (w >= h) {
      // A column down the left of what is left.
      const across = sum / h;
      let down = y;
      for (const item of row) {
        const tall = item.area / across;
        boxes[item.index] = { x, y: down, w: across, h: tall };
        down += tall;
      }
      x += across;
      w -= across;
    } else {
      // A row along the top of what is left.
      const tall = sum / w;
      let along = x;
      for (const item of row) {
        const wide = item.area / tall;
        boxes[item.index] = { x: along, y, w: wide, h: tall };
        along += wide;
      }
      y += tall;
      h -= tall;
    }
  }
  return boxes;
}
