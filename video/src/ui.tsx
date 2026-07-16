import type {CSSProperties, ReactNode} from "react";
import {Img, interpolate, staticFile, useCurrentFrame} from "remotion";
import {colors, shadow} from "./theme";

export const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 15, duration - 15, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const rise = (frame: number, delay = 0, distance = 30) =>
  interpolate(frame, [delay, delay + 22], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const appear = (frame: number, delay = 0, length = 18) =>
  interpolate(frame, [delay, delay + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const Scene: React.FC<{
  duration: number;
  children: ReactNode;
  style?: CSSProperties;
}> = ({duration, children, style}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        opacity: fade(frame, duration),
        background: colors.black,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Grain: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{pointerEvents: "none", position: "absolute", inset: 0, opacity: 0.08, mixBlendMode: "soft-light"}}
  >
    <filter id="grain-noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch" />
    </filter>
    <rect width="100%" height="100%" filter="url(#grain-noise)" opacity="0.42" />
  </svg>
);

export const Eyebrow: React.FC<{children: ReactNode; style?: CSSProperties}> = ({children, style}) => (
  <div
    style={{
      fontSize: 20,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      fontWeight: 700,
      color: colors.amberSoft,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Brand: React.FC<{dark?: boolean; compact?: boolean}> = ({dark = false, compact = false}) => (
  <div style={{display: "flex", alignItems: "center", gap: compact ? 12 : 16}}>
    <div
      style={{
        display: "grid",
        placeItems: "center",
        width: compact ? 38 : 48,
        height: compact ? 38 : 48,
        borderRadius: 10,
        background: colors.amber,
      }}
    >
      <Img src={staticFile("logo.svg")} style={{width: compact ? 25 : 31, height: compact ? 25 : 31}} />
    </div>
    <div
      style={{
        fontSize: compact ? 25 : 32,
        fontWeight: 760,
        letterSpacing: "-0.04em",
        color: dark ? colors.ink : colors.cream,
      }}
    >
      OpenCandle
    </div>
  </div>
);

export const Window: React.FC<{
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  light?: boolean;
}> = ({children, title, style, light = false}) => (
  <div
    style={{
      borderRadius: 24,
      overflow: "hidden",
      border: `1px solid ${light ? "#D3D0C8" : colors.line}`,
      background: light ? "#F5F3EE" : colors.panel,
      boxShadow: shadow,
      ...style,
    }}
  >
    <div
      style={{
        height: 56,
        borderBottom: `1px solid ${light ? "#DAD7CF" : colors.line}`,
        display: "flex",
        alignItems: "center",
        padding: "0 22px",
        gap: 9,
        background: light ? "#ECE9E1" : "#0E120F",
      }}
    >
      {["#EF6A5E", "#EAB74E", "#58BD74"].map((color) => (
        <div key={color} style={{width: 11, height: 11, borderRadius: 99, background: color, opacity: 0.9}} />
      ))}
      {title ? (
        <div
          className="mono"
          style={{
            marginLeft: 12,
            fontSize: 15,
            color: light ? "#696C67" : colors.muted,
            flex: 1,
            textAlign: "center",
            paddingRight: 72,
          }}
        >
          {title}
        </div>
      ) : null}
    </div>
    {children}
  </div>
);

export const Pill: React.FC<{
  children: ReactNode;
  tone?: "amber" | "green" | "muted" | "red" | "blue";
  style?: CSSProperties;
}> = ({children, tone = "muted", style}) => {
  const color = {
    amber: colors.amberSoft,
    green: colors.green,
    muted: colors.muted,
    red: colors.red,
    blue: colors.blue,
  }[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        border: `1px solid ${color}55`,
        background: `${color}13`,
        color,
        borderRadius: 999,
        padding: "7px 11px",
        fontSize: 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Cursor: React.FC<{x: number; y: number; click?: boolean}> = ({x, y, click = false}) => {
  const frame = useCurrentFrame();
  const clickScale = click
    ? interpolate(frame % 34, [0, 6, 14], [1, 0.78, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  return (
    <div style={{position: "absolute", left: x, top: y, transform: `scale(${clickScale})`, transformOrigin: "0 0"}}>
      <svg width="38" height="45" viewBox="0 0 38 45" fill="none">
        <path d="M4 3L31 28H18L11 41L4 3Z" fill="#F7F5EF" stroke="#161916" strokeWidth="3" />
      </svg>
    </div>
  );
};

export const Sparkline: React.FC<{points: number[]; color?: string; progress?: number}> = ({
  points,
  color = colors.green,
  progress = 1,
}) => {
  const width = 180;
  const height = 54;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const path = points
    .map((point, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((point - min) / Math.max(1, max - min)) * (height - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{overflow: "visible"}}>
      <path d={path} fill="none" stroke={`${color}2A`} strokeWidth="7" strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - progress}
      />
    </svg>
  );
};
