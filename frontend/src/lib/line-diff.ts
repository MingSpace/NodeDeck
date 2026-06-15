// 简单的行级近似 diff:把每一行作为不可分原子,通过 multiset 相消找出新增/删除。
// 不是 LCS,所以"行的位移"会被识别成"删除一个 + 新增一个"——对实时预览(yaml dump 顺序稳定)足够用,
// 而且实现是 O(n),没有二次方爆炸。

export interface LineDiffResult {
  addedLines: number[]; // 1-based,可直接喂给 Monaco Range
  addedCount: number;
  removedCount: number;
}

export function computeLineDiff(prev: string, next: string): LineDiffResult {
  if (prev === next) {
    return { addedLines: [], addedCount: 0, removedCount: 0 };
  }
  const prevLines = prev.length === 0 ? [] : prev.split("\n");
  const nextLines = next.length === 0 ? [] : next.split("\n");

  const prevCount = new Map<string, number>();
  for (const l of prevLines) {
    prevCount.set(l, (prevCount.get(l) ?? 0) + 1);
  }

  const addedLines: number[] = [];
  let consumedFromPrev = 0;
  for (let i = 0; i < nextLines.length; i++) {
    const line = nextLines[i];
    const remaining = prevCount.get(line) ?? 0;
    if (remaining > 0) {
      prevCount.set(line, remaining - 1);
      consumedFromPrev++;
    } else {
      addedLines.push(i + 1);
    }
  }

  const removedCount = prevLines.length - consumedFromPrev;
  return { addedLines, addedCount: addedLines.length, removedCount };
}
