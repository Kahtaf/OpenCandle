import { Globe } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils.js";
import { hostFrom } from "./favicon-utils.js";

const SIZE_CLASS = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

// Round favicon with an inset hairline ring and a Globe fallback on load
// failure. Uses Google's favicon service so it works for any host without
// per-source manual wiring.
export function Favicon({ url, size = "sm", className }) {
  const host = hostFrom(url);
  const [errored, setErrored] = useState(false);
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.sm;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary",
        sizeClass,
        className,
      )}
      aria-hidden="true"
    >
      {host && !errored ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <Globe className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
      )}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-foreground/10" />
    </span>
  );
}
