import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from "remotion";
import {colors} from "../theme";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const fade = (frame: number, duration: number, edge = 8) =>
  interpolate(frame, [0, edge, duration - edge, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const FilmGrain: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.022,
      mixBlendMode: "multiply",
    }}
  >
    <filter id="cta-grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" stitchTiles="stitch" />
    </filter>
    <rect width="100%" height="100%" filter="url(#cta-grain)" />
  </svg>
);

export const CtaScene: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const contentIn = interpolate(frame, [8, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const commandIn = interpolate(frame, [38, 72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill style={{background: colors.cream, color: colors.ink, opacity: fade(frame, duration)}}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle 720px at 50% 44%, rgba(196,145,53,0.16), transparent 72%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 410,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          opacity: contentIn,
          translate: `0 ${interpolate(contentIn, [0, 1], [26, 0])}px`,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            display: "grid",
            placeItems: "center",
            background: colors.amber,
          }}
        >
          <Img src={staticFile("logo.svg")} style={{width: 47, height: 47}} />
        </div>
        <div style={{fontSize: 68, fontWeight: 760, letterSpacing: "-0.055em"}}>OpenCandle</div>
      </div>
      <div
        className="mono"
        style={{
          position: "absolute",
          left: "50%",
          top: 576,
          padding: "19px 30px 20px",
          borderRadius: 15,
          border: "1px solid rgba(23,24,22,0.16)",
          background: "rgba(255,255,255,0.56)",
          boxShadow: "0 20px 60px rgba(82,67,36,0.10)",
          fontSize: 31,
          letterSpacing: "-0.025em",
          opacity: commandIn,
          translate: `-50% ${interpolate(commandIn, [0, 1], [16, 0])}px`,
        }}
      >
        <span style={{color: colors.muted}}>$</span> npx opencandle
      </div>
      <FilmGrain />
    </AbsoluteFill>
  );
};
