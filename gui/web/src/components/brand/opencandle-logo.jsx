import logoUrl from "../../../../../assets/logo.svg";

export function OpenCandleLogo({ className = "h-5 w-5" }) {
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      width="20"
      height="20"
      className={`shrink-0 ${className}`}
      draggable="false"
    />
  );
}
