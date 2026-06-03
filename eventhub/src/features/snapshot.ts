export function snapshotSet<T>(set: Set<T>): T[] {
  const arr = new Array<T>(set.size);
  let i = 0;
  for (const item of set) {
    arr[i++] = item;
  }
  return arr;
}
