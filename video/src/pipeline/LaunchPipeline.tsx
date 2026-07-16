import {Video} from "@remotion/media";
import {
  FileText,
  Landmark,
  Layers3,
  LineChart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import pipeline from "../../pipeline/launch-pipeline.json";
import {colors} from "../theme";
import {CtaScene} from "./CtaScene";

type PipelineBeat = (typeof pipeline.beats)[number] & {trimBefore?: number};
type ApprovedAsset = keyof typeof pipeline.assets;

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const beatOpacity = (frame: number, beat: PipelineBeat) => {
  const fadeIn = beat.transitionIn === 0
    ? 1
    : interpolate(frame, [0, beat.transitionIn], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: ease,
      });
  const fadeOut = beat.transitionOut === 0
    ? 1
    : interpolate(
        frame,
        [beat.duration - beat.transitionOut, beat.duration],
        [1, 0],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        },
      );

  return Math.min(fadeIn, fadeOut);
};

const approvedFile = (assetId: ApprovedAsset) =>
  pipeline.assets[assetId].public.replace(/^public\//, "");

const ApprovedClip: React.FC<{
  assetId: ApprovedAsset;
  playbackRate: number;
  trimBefore?: number;
}> = ({assetId, playbackRate, trimBefore = 0}) => (
  <AbsoluteFill style={{background: colors.black}}>
    <Video
      src={staticFile(approvedFile(assetId))}
      playbackRate={playbackRate}
      trimBefore={trimBefore}
      muted
      objectFit="cover"
      style={{width: "100%", height: "100%"}}
    />
  </AbsoluteFill>
);

const BrowserWorkflowScene: React.FC = () => {
  const guiBeat = pipeline.beats.find((beat) => beat.surface === "gui") as PipelineBeat;
  const tourBeat = pipeline.beats.find((beat) => beat.surface === "architecture") as PipelineBeat;
  const tourStart = tourBeat.from - guiBeat.from - (tourBeat.trimBefore ?? 0);

  return (
    <AbsoluteFill>
      <ApprovedClip assetId="gui" playbackRate={guiBeat.playbackRate ?? 1} trimBefore={guiBeat.trimBefore} />
      <Sequence from={tourStart}>
        <ApprovedClip assetId="architecture" playbackRate={1} />
      </Sequence>
    </AbsoluteFill>
  );
};

const FrozenSurface: React.FC<{
  kind: "tui" | "gui";
  width: number;
  height: number;
}> = ({kind, width, height}) => (
  <div
    style={{
      position: "relative",
      width,
      height,
      overflow: "hidden",
      borderRadius: 22,
      border: kind === "gui"
        ? "1px solid rgba(24,24,27,.18)"
        : "1px solid rgba(255,255,255,.16)",
      background: kind === "gui" ? "#fff" : "#030303",
      boxShadow: "0 38px 100px rgba(0,0,0,.38)",
    }}
  >
    <Img
      src={staticFile(approvedFile(kind === "gui" ? "dualGui" : "dualTui"))}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  </div>
);

const evidenceCardWidth = 320;
const evidenceCardHeight = 132;

const hookEvidence = [
  {label: "QUOTE", icon: TrendingUp, x: 100, y: 210, start: 214},
  {label: "PRICE", icon: LineChart, x: 1500, y: 210, start: 218},
  {label: "SEC", icon: FileText, x: 80, y: 718, start: 222},
  {label: "MACRO", icon: Landmark, x: 1520, y: 718, start: 226},
  {label: "OPTIONS", icon: Layers3, x: 800, y: 812, start: 230},
] as const;

const chatbotBrands = [
  {
    label: "OpenAI",
    src: "brands/openai.svg",
    x: 510,
    y: 460,
    start: 104,
    fromX: -700,
    fromY: -190,
    fromRotate: -24,
    exitX: -820,
    exitY: 260,
    exitRotate: -34,
    exitDelay: 0,
  },
  {
    label: "Claude",
    src: "brands/claude.svg",
    x: 760,
    y: 460,
    start: 120,
    fromX: -220,
    fromY: -620,
    fromRotate: 18,
    exitX: -420,
    exitY: -760,
    exitRotate: 28,
    exitDelay: 1,
  },
  {
    label: "Gemini",
    src: "brands/gemini.svg",
    x: 1010,
    y: 460,
    start: 136,
    fromX: 220,
    fromY: -620,
    fromRotate: -18,
    exitX: 420,
    exitY: -760,
    exitRotate: -28,
    exitDelay: 1,
  },
  {
    label: "Grok",
    src: "brands/grok.svg",
    x: 1260,
    y: 460,
    start: 152,
    fromX: 700,
    fromY: -190,
    fromRotate: 24,
    exitX: 820,
    exitY: 260,
    exitRotate: 34,
    exitDelay: 2,
  },
] as const;

const hookCandles = [
  {open: 358, close: 350, high: 286, low: 448, probeA: 392, probeB: 332},
  {open: 468, close: 528, high: 424, low: 558, probeA: 438, probeB: 548},
  {open: 586, close: 612, high: 534, low: 638, probeA: 626, probeB: 568},
  {open: 574, close: 646, high: 548, low: 680, probeA: 542, probeB: 666},
  {open: 650, close: 656, high: 592, low: 676, probeA: 674, probeB: 636},
  {open: 658, close: 578, high: 550, low: 684, probeA: 690, probeB: 552},
  {open: 516, close: 524, high: 462, low: 548, probeA: 486, probeB: 542},
  {open: 512, close: 502, high: 474, low: 558, probeA: 536, probeB: 488},
  {open: 506, close: 564, high: 480, low: 594, probeA: 476, probeB: 584},
  {open: 514, close: 506, high: 486, low: 540, probeA: 532, probeB: 494},
  {open: 516, close: 574, high: 474, low: 600, probeA: 548, probeB: 596},
  {open: 562, close: 468, high: 434, low: 604, probeA: 594, probeB: 444},
  {open: 452, close: 542, high: 404, low: 564, probeA: 416, probeB: 560},
  {open: 526, close: 448, high: 420, low: 556, probeA: 552, probeB: 428},
  {open: 438, close: 344, high: 316, low: 468, probeA: 466, probeB: 322},
  {open: 356, close: 522, high: 328, low: 558, probeA: 324, probeB: 546},
  {open: 520, close: 486, high: 420, low: 592, probeA: 552, probeB: 466},
  {open: 548, close: 558, high: 510, low: 596, probeA: 524, probeB: 576},
  {open: 562, close: 482, high: 454, low: 592, probeA: 594, probeB: 458},
  {open: 496, close: 522, high: 474, low: 550, probeA: 540, probeB: 482},
  {open: 528, close: 576, high: 502, low: 604, probeA: 496, probeB: 594},
  {open: 584, close: 592, high: 544, low: 616, probeA: 606, probeB: 570},
  {open: 594, close: 560, high: 532, low: 622, probeA: 618, probeB: 540},
  {open: 566, close: 618, high: 536, low: 648, probeA: 540, probeB: 638},
  {open: 620, close: 456, high: 424, low: 652, probeA: 654, probeB: 430},
  {open: 470, close: 350, high: 294, low: 498, probeA: 504, probeB: 322},
] as const;

const hookQuestions = [
  {x: 600, y: 352, size: 92, color: colors.amber, rotate: -16, start: 48},
  {x: 760, y: 424, size: 142, color: colors.ink, rotate: 11, start: 51},
  {x: 944, y: 330, size: 80, color: colors.green, rotate: -7, start: 54},
  {x: 1080, y: 430, size: 128, color: "#cf4a3f", rotate: 14, start: 57},
  {x: 1268, y: 354, size: 88, color: colors.amber, rotate: -12, start: 60},
  {x: 670, y: 592, size: 74, color: colors.green, rotate: 9, start: 63},
  {x: 860, y: 618, size: 106, color: "#6f5669", rotate: -14, start: 66},
  {x: 1010, y: 564, size: 156, color: colors.ink, rotate: 6, start: 69},
  {x: 1210, y: 620, size: 74, color: colors.green, rotate: 15, start: 72},
  {x: 1370, y: 540, size: 102, color: colors.amber, rotate: -8, start: 75},
] as const;

const HookCandlestickChart: React.FC<{frame: number}> = ({frame}) => (
  <svg
    width="1920"
    height="1080"
    viewBox="0 0 1920 1080"
    style={{
      position: "absolute",
      inset: 0,
      opacity: interpolate(frame, [0, 10, 96, 114], [0, 0.82, 0.82, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    }}
  >
    {hookCandles.map((candle, index) => {
      const start = index * 4;
      const x = 82 + index * 70.2;
      const visible = interpolate(frame, [start, start + 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const currentClose = interpolate(
        frame,
        [start, start + 1, start + 2, start + 4],
        [candle.open, candle.probeA, candle.probeB, candle.close],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.32, 0, 0.2, 1),
        },
      );
      const settle = interpolate(frame, [start, start + 4], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: ease,
      });
      const formingHigh = interpolate(settle, [0, 1], [candle.open, candle.high]);
      const formingLow = interpolate(settle, [0, 1], [candle.open, candle.low]);
      const currentHigh = Math.min(candle.open, currentClose, formingHigh);
      const currentLow = Math.max(candle.open, currentClose, formingLow);
      const rising = currentClose < candle.open;
      const color = rising ? colors.green : "#cf4a3f";
      const bodyTop = Math.min(candle.open, currentClose);
      const bodyHeight = Math.max(8, Math.abs(currentClose - candle.open));

      return (
        <g key={`${candle.open}-${index}`} opacity={visible}>
          <line
            x1={x}
            y1={currentHigh}
            x2={x}
            y2={currentLow}
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <rect
            x={x - 14}
            y={bodyTop}
            width={28}
            height={bodyHeight}
            rx={4}
            fill={color}
          />
        </g>
      );
    })}
  </svg>
);

const HookQuestionField: React.FC<{frame: number}> = ({frame}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      zIndex: 4,
      opacity: interpolate(frame, [44, 50, 96, 112], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: ease,
      }),
    }}
  >
    {hookQuestions.map((question, index) => {
      const enter = interpolate(frame, [question.start, question.start + 8], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: ease,
      });
      const drift = interpolate(frame, [question.start, 112], [18, -12], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return (
        <span
          key={`${question.x}-${question.y}`}
          style={{
            position: "absolute",
            left: question.x,
            top: question.y,
            color: question.color,
            fontSize: question.size,
            lineHeight: 1,
            fontWeight: 760,
            opacity: enter * (0.62 + (index % 3) * 0.14),
            translate: `${interpolate(enter, [0, 1], [index % 2 === 0 ? -30 : 30, 0])}px ${drift}px`,
            rotate: `${interpolate(enter, [0, 1], [question.rotate * 1.8, question.rotate])}deg`,
            scale: interpolate(enter, [0, 1], [0.45, 1]),
          }}
        >
          ?
        </span>
      );
    })}
  </div>
);

const ChatbotBrandBadge: React.FC<(typeof chatbotBrands)[number] & {frame: number}> = ({
  frame,
  label,
  src,
  x,
  y,
  start,
  fromX,
  fromY,
  fromRotate,
  exitX,
  exitY,
  exitRotate,
  exitDelay,
}) => {
  const enter = interpolate(frame, [start, start + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const exit = interpolate(frame, [199 + exitDelay, 216 + exitDelay], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const exitOpacity = interpolate(frame, [208 + exitDelay, 216 + exitDelay], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enterX = interpolate(enter, [0, 1], [fromX, 0]);
  const enterY = interpolate(enter, [0, 1], [fromY, 0]);
  const enterRotate = interpolate(enter, [0, 1], [fromRotate, 0]);

  return (
    <div
      aria-label={label}
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 7,
        width: 150,
        height: 150,
        display: "grid",
        placeItems: "center",
        borderRadius: 36,
        border: "1px solid rgba(23,24,22,.16)",
        background: "rgba(255,255,255,.96)",
        boxShadow: "0 24px 64px rgba(0,0,0,.18)",
        opacity: enter * exitOpacity,
        translate: `${enterX + exit * exitX}px ${enterY + exit * exitY}px`,
        rotate: `${enterRotate + exit * exitRotate}deg`,
        scale:
          interpolate(enter, [0, 1], [0.38, 1]) *
          interpolate(exit, [0, 0.22, 1], [1, 1.08, 0.76]),
      }}
    >
      <Img src={staticFile(src)} style={{width: 86, height: 86, objectFit: "contain"}} />
    </div>
  );
};

const HookGrain: React.FC<{frame: number}> = ({frame}) => (
  <svg
    width="100%"
    height="100%"
    style={{
      position: "absolute",
      inset: 0,
      zIndex: 30,
      pointerEvents: "none",
      opacity: interpolate(frame, [0, 270, 294], [0.026, 0.026, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
      mixBlendMode: "multiply",
    }}
  >
    <filter id="hook-grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.76" numOctaves="3" stitchTiles="stitch" />
    </filter>
    <rect width="100%" height="100%" filter="url(#hook-grain)" />
  </svg>
);

const HookEvidenceCard: React.FC<{
  frame: number;
  label: string;
  icon: LucideIcon;
  x: number;
  y: number;
  start: number;
}> = ({frame, label, icon: Icon, x, y, start}) => {
  const enter = interpolate(frame, [start, start + 11], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: evidenceCardWidth,
        height: evidenceCardHeight,
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "20px 22px",
        borderRadius: 24,
        border: "1px solid rgba(23,24,22,.14)",
        background: "rgba(255,255,255,.92)",
        boxShadow: "0 24px 60px rgba(71,58,31,.12)",
        color: colors.ink,
        opacity: enter,
        translate: `${interpolate(enter, [0, 1], [960 - x - evidenceCardWidth / 2, 0])}px ${interpolate(enter, [0, 1], [540 - y - evidenceCardHeight / 2, 0])}px`,
        scale: interpolate(enter, [0, 1], [0.66, 1]),
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          borderRadius: 17,
          border: "1px solid rgba(196,145,53,.52)",
          background: "rgba(226,189,116,.18)",
          color: colors.amber,
        }}
      >
        <Icon size={34} strokeWidth={1.7} />
      </div>
      <div style={{minWidth: 0, flex: 1}}>
        <div style={{fontSize: 24, fontWeight: 780, letterSpacing: ".12em"}}>{label}</div>
        <div style={{display: "grid", gap: 9, marginTop: 14}}>
          <span style={{height: 7, borderRadius: 7, background: "rgba(23,24,22,.18)"}} />
          <span style={{width: "64%", height: 7, borderRadius: 7, background: "rgba(110,154,128,.44)"}} />
        </div>
      </div>
    </div>
  );
};

const HookEvidenceLayer: React.FC<{frame: number}> = ({frame}) => {
  const retreat = interpolate(frame, [270, 286], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill
      style={{
        zIndex: 6,
        opacity: 1 - retreat,
        scale: interpolate(retreat, [0, 1], [1, 0.83]),
      }}
    >
      <svg
        width="1920"
        height="1080"
        viewBox="0 0 1920 1080"
        style={{position: "absolute", inset: 0}}
      >
        {hookEvidence.map(({x, y, start, label}) => {
          const pathProgress = interpolate(frame, [start - 3, start + 9], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          });
          return (
            <path
              key={label}
              d={`M 960 540 C 960 ${y + evidenceCardHeight / 2}, ${x + evidenceCardWidth / 2} 540, ${x + evidenceCardWidth / 2} ${y + evidenceCardHeight / 2}`}
              fill="none"
              stroke={colors.amber}
              strokeWidth={2}
              strokeOpacity={0.46}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - pathProgress}
            />
          );
        })}
      </svg>
      {hookEvidence.map((item) => (
        <HookEvidenceCard key={item.label} frame={frame} {...item} />
      ))}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 626,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "15px 24px",
          borderRadius: 999,
          border: "1px solid rgba(23,24,22,.13)",
          background: "rgba(255,255,255,.84)",
          boxShadow: "0 18px 48px rgba(71,58,31,.10)",
          color: colors.muted,
          fontSize: 22,
          fontWeight: 690,
          opacity: interpolate(frame, [224, 235], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          translate: "-50% 0",
        }}
      >
        <span style={{display: "inline-flex", gap: 5}}>
          {[colors.green, "#6f5669", colors.green].map((color, index) => (
            <i key={`${color}-${index}`} style={{width: 14, height: 14, borderRadius: 14, background: color}} />
          ))}
        </span>
        <span>9 sources</span>
        <span style={{width: 1, height: 22, background: "rgba(23,24,22,.15)"}} />
        <span>6 steps</span>
      </div>
    </AbsoluteFill>
  );
};

const BrowserProofScene: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const brandIn = interpolate(frame, [182, 188], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const impact = interpolate(frame, [196, 200, 212], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const wordmarkIn = interpolate(frame, [203, 211], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const guiIn = interpolate(frame, [270, 294], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill style={{background: colors.paper, overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: interpolate(frame, [0, 270, 294], [1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          backgroundImage:
            "linear-gradient(rgba(23,24,22,.042) 1px, transparent 1px), linear-gradient(90deg, rgba(23,24,22,.042) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          translate: `${interpolate(frame, [0, 270], [0, -24], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px 0`,
        }}
      />

      <HookCandlestickChart frame={frame} />
      <HookQuestionField frame={frame} />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 124,
          zIndex: 2,
          color: colors.ink,
          textAlign: "center",
          opacity: interpolate(frame, [0, 12, 88, 106], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          translate: `0 ${interpolate(frame, [0, 18], [32, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          })}px`,
        }}
      >
        <div style={{fontSize: 104, lineHeight: 0.92, fontWeight: 790, letterSpacing: "-.055em"}}>FINANCIAL ANSWERS</div>
      </div>

      {chatbotBrands.map((brand) => (
        <ChatbotBrandBadge key={brand.label} frame={frame} {...brand} />
      ))}

      <div
        style={{
          position: "absolute",
          left: 860,
          top: 435,
          zIndex: 18,
          width: 200,
          height: 200,
          borderRadius: 999,
          border: `4px solid ${colors.amber}`,
          boxShadow: `0 0 60px ${colors.amber}44`,
          opacity: impact * 0.72,
          scale: interpolate(frame, [196, 200, 212], [0.28, 0.72, 1.72], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 954,
          top: interpolate(frame, [182, 199], [620, 548], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          zIndex: 17,
          width: 12,
          height: interpolate(frame, [182, 199], [460, 110], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          borderRadius: 999,
          background: `linear-gradient(180deg, ${colors.amber}cc, ${colors.amber}00)`,
          opacity: interpolate(frame, [182, 188, 198, 203], [0, 0.62, 0.46, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          transformOrigin: "top center",
        }}
      />

      <HookEvidenceLayer frame={frame} />

      <div
        style={{
          position: "absolute",
          left: interpolate(frame, [182, 199, 203, 211, 270, 292], [923, 923, 900, 720, 720, 24], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          top: interpolate(frame, [182, 199, 203, 211, 270, 292], [1160, 498, 484, 484, 484, 24], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 18,
          color: colors.ink,
          opacity: brandIn * interpolate(frame, [291, 294], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          rotate: `${interpolate(frame, [182, 199, 205], [12, -3, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          })}deg`,
          scale: interpolate(frame, [182, 199, 203, 211, 270, 292], [0.5, 1.18, 0.94, 1, 1, 0.5], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          }),
          transformOrigin: "top left",
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            display: "grid",
            placeItems: "center",
            borderRadius: 18,
            boxShadow: "0 18px 54px rgba(196,145,53,.28)",
          }}
        >
          <Img src={staticFile("logo.svg")} style={{width: 74, height: 74}} />
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 770,
            letterSpacing: "-.055em",
            opacity: wordmarkIn,
            translate: `${interpolate(wordmarkIn, [0, 1], [30, 0])}px 0`,
          }}
        >
          OpenCandle
        </div>
      </div>

      <Sequence name="GUI opening-state match" durationInFrames={duration}>
        <AbsoluteFill
          style={{
            zIndex: 10,
            overflow: "hidden",
            borderRadius: interpolate(guiIn, [0, 1], [46, 0]),
            boxShadow: `0 ${interpolate(guiIn, [0, 1], [52, 0])}px ${interpolate(guiIn, [0, 1], [120, 0])}px rgba(30,25,16,.24)`,
            clipPath: `inset(${interpolate(guiIn, [0, 1], [9, 0])}% ${interpolate(guiIn, [0, 1], [7, 0])}% round ${interpolate(guiIn, [0, 1], [46, 0])}px)`,
            opacity: interpolate(frame, [270, 277], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(guiIn, [0, 1], [0.92, 1]),
          }}
        >
          <Img
            src={staticFile(approvedFile("guiStart"))}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              zIndex: 2,
              width: 272,
              height: 76,
              background: "#f4f4f5",
              opacity: interpolate(frame, [291, 294], [1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />
        </AbsoluteFill>
      </Sequence>

      <HookGrain frame={frame} />
    </AbsoluteFill>
  );
};

const DualApprovedScene: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [0, 30], [38, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const handoff = interpolate(frame, [28, 86], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const breathe = interpolate(frame, [108, duration], [1, 1.012], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill style={{background: colors.black, overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle 760px at 50% 52%, rgba(196,145,53,.11), transparent 76%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 170,
          zIndex: 1,
          translate: `${interpolate(handoff, [0, 1], [0, -34])}px ${settle + interpolate(handoff, [0, 1], [0, -24])}px`,
          scale: interpolate(handoff, [0, 1], [1, 0.96]) * breathe,
        }}
      >
        <FrozenSurface kind="gui" width={1060} height={596} />
      </div>
      <div
        style={{
          position: "absolute",
          right: 70,
          top: 292,
          zIndex: 2,
          opacity: interpolate(handoff, [0, 0.24, 1], [0, 1, 1]),
          translate: `${interpolate(handoff, [0, 1], [86, 0])}px ${settle}px`,
          scale: interpolate(handoff, [0, 1], [0.92, 1]) * breathe,
        }}
      >
        <FrozenSurface kind="tui" width={1060} height={596} />
      </div>
    </AbsoluteFill>
  );
};

export const PipelineBeatScene: React.FC<{beat: PipelineBeat}> = ({beat}) => {
  const frame = useCurrentFrame();
  const opacity = beatOpacity(frame, beat);

  let content: React.ReactNode;
  switch (beat.surface) {
    case "proof":
      content = <BrowserProofScene duration={beat.duration} />;
      break;
    case "tui":
      content = <ApprovedClip assetId="tui" playbackRate={beat.playbackRate ?? 1} trimBefore={beat.trimBefore} />;
      break;
    case "architecture":
      content = <ApprovedClip assetId="architecture" playbackRate={beat.playbackRate ?? 1} trimBefore={beat.trimBefore} />;
      break;
    case "gui":
      content = <BrowserWorkflowScene />;
      break;
    case "dual":
      content = <DualApprovedScene duration={beat.duration} />;
      break;
    case "cta":
      content = <CtaScene duration={beat.duration} />;
      break;
  }

  return (
    <AbsoluteFill
      data-beat-id={beat.id}
      style={{background: colors.black, opacity}}
    >
      {content}
    </AbsoluteFill>
  );
};
