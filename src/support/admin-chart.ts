import { expect, type Locator } from '@playwright/test';

/** The smallest side, in pixels, of a bar of a sales chart: gridlines are thinner, lettering is shorter. */
export const MIN_BAR = 20;

/** What `measureBars` reads off a chart: whether anything at all is drawn, and the height of each bar, left to right. */
export interface DrawnChart {
  anyInk: boolean;
  bars: number[];
}

/**
 * Reads the bars off a chart <canvas>: a bar is a run of non-white pixels at least `minBar` tall and `minBar` wide
 * (gridlines, lettering and the swatches of the legend are none of them; `minBar` is in CSS pixels). Runs in the page (`locator.evaluate`), so it uses nothing outside itself.
 */
export function measureBars(canvas: HTMLCanvasElement, cssMinBar: number): DrawnChart {
  const { width, height } = canvas;
  // The canvas is drawn in device pixels (a Retina WebKit canvas is twice as wide as it is on screen), so the smallest bar is too: the
  // 12 px swatches of the legend are 24 px there and must stay below it.
  const shown = canvas.getBoundingClientRect().width;
  const minBar = Math.round(cssMinBar * (shown > 0 ? width / shown : 1));
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

/** One unsettled read of a chart <canvas> (the named helper for specs, which may not run code in the page): see `measureBars`. */
export function readChart(chart: Locator): Promise<DrawnChart> {
  return chart.evaluate(measureBars, MIN_BAR);
}

/**
 * The heights, in pixels and left to right, of the bars a chart <canvas> has drawn, once its animation has ended. A <canvas>
 * has nothing to read and the app colours each bar at random, so the picture is measured, not compared (`measureBars`). The
 * chart is taken as finished when two reads 250 ms apart agree on the bars and something is drawn at all (axes are drawn even
 * for a report that is empty or failed, so a blank canvas is a chart that has not started).
 */
export async function drawnBars(chart: Locator): Promise<number[]> {
  let previous = '';
  let bars: number[] = [];
  await expect.poll(async () => {
    const read = await readChart(chart);
    const key = JSON.stringify(read);
    const settled = read.anyInk && key === previous;
    previous = key;
    bars = read.bars;
    return settled;
  }, { message: 'the chart finished drawing', intervals: [250] }).toBe(true);
  return bars;
}
