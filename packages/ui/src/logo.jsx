// `label` is for the places where the mark is the content rather than chrome
// beside a visible wordmark. Left off, it stays decorative, which is right
// everywhere it sits next to the product name already.
export function OpenCandleLogo({ className = "h-5 w-5", src = "/assets/logo.svg", label }) {
  return (
    <img
      src={src}
      alt={label ?? ""}
      aria-hidden={label ? undefined : "true"}
      width="20"
      height="20"
      className={`shrink-0 ${className}`}
      draggable="false"
    />
  );
}
