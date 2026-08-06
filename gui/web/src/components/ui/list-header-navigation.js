// Roving-tabindex arrow key math for `ListTabs`. It lives beside the component
// instead of inside it so the component module exports components only and Fast
// Refresh can preserve tab state across edits.
export function nextListTabIndex(currentIndex, itemCount, key) {
  if (itemCount < 1) return -1;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + itemCount) % itemCount;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return currentIndex;
}
