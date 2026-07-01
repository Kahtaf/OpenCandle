export function OpenCandleLogo({ className = "h-5 w-5", src = "/assets/logo.svg" }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width="20"
      height="20"
      className={`shrink-0 ${className}`}
      draggable="false"
    />
  );
}
