/** The smallest side, in pixels, of a bar of a sales chart: gridlines are thinner, lettering is shorter. */
export const MIN_BAR = 20;

/** What `measureBars` reads off a chart: whether anything at all is drawn, and the height of each bar, left to right. */
export interface DrawnChart {
  anyInk: boolean;
  bars: number[];
}

/**
 * Reads the bars off a chart <canvas>: a bar is a run of non-white pixels at least `minBar` tall and `minBar` wide
 * (gridlines and lettering are neither). Runs in the page (`locator.evaluate`), so it uses nothing outside itself.
 */
export function measureBars(canvas: HTMLCanvasElement, minBar: number): DrawnChart {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
  const inked = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    return data[at + 3] > 0 && (data[at] < 245 || data[at + 1] < 245 || data[at + 2] < 245);
  };
  const longestRun = (x: number) => {
    let best = 0;
    for (let y = 0, start = -1; y <= height; y++) {
      if (y < height && inked(x, y)) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        best = Math.max(best, y - start);
        start = -1;
      }
    }
    return best;
  };
  let anyInk = false;
  for (let i = 3; i < data.length && !anyInk; i += 4) anyInk = data[i] > 0;
  const bars: number[] = [];
  let from = -1;
  for (let x = 0; x <= width; x++) {
    const tall = x < width ? longestRun(x) : 0;
    if (tall >= minBar) {
      if (from < 0) from = x;
    } else if (from >= 0) {
      if (x - from >= minBar) bars.push(longestRun(Math.floor((from + x) / 2)));
      from = -1;
    }
  }
  return { anyInk, bars };
}
