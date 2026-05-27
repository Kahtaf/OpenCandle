import { useMemo } from "react";

export function useStableId(prefix = "field") {
  const id = useMemo(() => `${prefix}-${Math.random().toString(36).slice(2, 8)}`, [prefix]);
  return id;
}
