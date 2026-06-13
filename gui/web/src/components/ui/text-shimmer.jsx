import { cn } from "../../lib/utils.js";

// Gradient-sweep loading label. The trick lives in styles.css under
// `.tool-shimmer`: a thin foreground stripe slides left-to-right across an
// otherwise muted base color. When `active` flips false the animation is
// removed and the text settles to the static "completed" color.
export function TextShimmer({ children, active = true, className, as: Tag = "span" }) {
  return (
    <Tag
      className={cn("tool-shimmer-base", active && "tool-shimmer", className)}
      data-shimmer={active ? "on" : "off"}
    >
      {children}
    </Tag>
  );
}
