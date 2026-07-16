import type {CSSProperties, ReactNode} from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import motion from "../../motion/tui-interaction.json";

const mono = '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const viewportScale = 1920 / 1152;
const userPrompt = "I have $50k to invest for 5+ years and already own AAPL and TSLA. Does adding NVDA make sense right now? Use current price, fundamentals, filings/news, sentiment, macro context, and portfolio concentration risk.";
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const reveal = (frame: number, start: number, duration = 10): CSSProperties => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  }),
  translate: `0 ${interpolate(frame, [start, start + duration], [7, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  })}px`,
});

const ToolRow = ({children, frame, start}: {children: ReactNode; frame: number; start: number}) => (
  <div
    style={{
      ...reveal(frame, start, 8),
      minHeight: 35,
      display: "flex",
      alignItems: "center",
      padding: "0 10px",
      background: "#202127",
      color: "#e7e5ea",
      fontSize: 11.8,
      fontWeight: 700,
      letterSpacing: -0.2,
    }}
  >
    {children}
  </div>
);

export const OpenCandleTUI: React.FC = () => {
  const frame = useCurrentFrame();
  const cursor = frame % 24 < 16;
  const promptLength = Math.floor(interpolate(frame, [motion.events.typingStart, motion.events.typingEnd], [0, userPrompt.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const cameraZoom = interpolate(frame, motion.camera.frames, motion.camera.zoom, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cameraX = interpolate(frame, motion.camera.frames, motion.camera.x, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cameraY = interpolate(frame, motion.camera.frames, motion.camera.y, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cameraOriginX = interpolate(frame, motion.camera.frames, motion.camera.originX, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cameraOriginY = interpolate(frame, motion.camera.frames, motion.camera.originY, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill
      style={{
        background: "#030303",
        color: "#aaa7ad",
        fontFamily: mono,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1152,
          height: 648,
          scale: viewportScale,
          transformOrigin: "top left",
          overflow: "hidden",
          background: "#030303",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            scale: cameraZoom,
            translate: `${cameraX}px ${cameraY}px`,
            transformOrigin: `${cameraOriginX}px ${cameraOriginY}px`,
            overflow: "hidden",
            padding: "10px 16px",
            background: "#030303",
          }}
        >
          <div style={{position: "absolute", inset: 0, overflow: "hidden", opacity: 0.45}}>
          {Array.from({length: 28}).map((_, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                width: 850,
                height: 150,
                right: -230,
                bottom: -45 + index * 5,
                borderTop: "1px solid rgba(210,215,212,.16)",
                borderRadius: "50%",
                transform: `rotate(${-8 + index * 0.32}deg) skewX(-15deg)`,
              }}
            />
          ))}
        </div>
        <div
          style={{
            position: "relative",
            width: 1064,
            height: 628,
            margin: "0 auto",
            overflow: "hidden",
            border: "1px solid #29292d",
            borderRadius: 14,
            background: "#181818",
            boxShadow: "0 34px 90px rgba(0,0,0,.62)",
          }}
        >
        <div
          style={{
            height: 34,
            display: "flex",
            alignItems: "center",
            padding: "0 13px",
            background: "linear-gradient(#29292b,#222224)",
            borderBottom: "1px solid #111",
            color: "#a9a7aa",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <div style={{display: "flex", gap: 8, marginRight: 20}}>
            <span style={{width: 12, height: 12, borderRadius: 9, background: "#ff5f57"}} />
            <span style={{width: 12, height: 12, borderRadius: 9, background: "#febc2e"}} />
            <span style={{width: 12, height: 12, borderRadius: 9, background: "#28c840"}} />
          </div>
          <span style={{opacity: 0.8, marginRight: 8}}>▰</span>
          <span>opencandle — π — opencandle — node · npm run start</span>
        </div>

        <div style={{padding: "9px 10px 0", fontSize: 12.7, lineHeight: 1.32}}>
          <div style={{display: "flex", gap: 20, color: "#d2ced5", marginBottom: 3}}>
            <strong style={{color: "#efedf1"}}>pi v0.75.5</strong>
            <span><b style={{color: "#e4e0e8"}}>esc</b> interrupt</span>
            <span><b style={{color: "#e4e0e8"}}>ctrl+c</b> clear</span>
            <span><b style={{color: "#e4e0e8"}}>ctrl+d</b> exit</span>
          </div>
          <div style={{color: "#6f6d72", marginBottom: 4}}>
            Type a prompt, or type <span style={{color: "#aaa7ad"}}>/</span> for commands. Use <span style={{color: "#aaa7ad"}}>@</span> to reference files.
          </div>
          <div style={{color: "#77757a", marginBottom: 5}}>New session started</div>

          <div
            style={{
              ...reveal(frame, 8),
              minHeight: 50,
              borderRadius: 5,
              padding: "7px 9px",
              marginBottom: 7,
              background: "#313033",
              color: "#e5e2e8",
              lineHeight: 1.45,
            }}
          >
            {userPrompt.slice(0, promptLength)}
            {promptLength < userPrompt.length ? <span style={{opacity: cursor ? 1 : 0}}>▋</span> : null}
          </div>

          <div style={{...reveal(frame, 42), fontStyle: "italic", color: "#89868c", margin: "0 8px 6px", fontSize: 11.6}}>
            <div style={{fontWeight: 700, color: "#a6a3a9", marginBottom: 3}}>Assessing the NVDA Investment</div>
            <div>
              I’m currently breaking down the request to evaluate NVDA as a potential investment. I’m considering the user’s goals, current holdings, available funds, and investment timeline to identify the key requirements.
            </div>
            <div style={{fontWeight: 700, color: "#a6a3a9", marginTop: 5, marginBottom: 3}}>Gathering Data Concurrently</div>
            <div>
              I’ve realized I can run the data gathering tools in parallel. I’m collecting the current quote and fundamentals, macro context, portfolio correlation, sentiment, and recent filings.
            </div>
          </div>

          <div style={{display: "grid", gap: 5}}>
            <ToolRow frame={frame} start={64}>get_stock_quote</ToolRow>
            <ToolRow frame={frame} start={76}>get_company_overview</ToolRow>
            <ToolRow frame={frame} start={88}>analyze_correlation</ToolRow>
            <ToolRow frame={frame} start={100}>get_economic_data</ToolRow>
            <ToolRow frame={frame} start={112}>get_reddit_sentiment</ToolRow>
            <ToolRow frame={frame} start={124}>get_sec_filings</ToolRow>
          </div>

          <div style={{...reveal(frame, 138), margin: "7px 8px", color: "#87848a"}}>
            <span style={{color: "#6f8c77"}}>└</span> Working…
          </div>
        </div>

        <div style={{position: "absolute", left: 10, right: 10, bottom: 0}}>
          <div style={{height: 1, background: "#7c657c"}} />
          <div style={{height: 27, display: "flex", alignItems: "center", borderBottom: "1px solid #6f5d70"}}>
            <span
              style={{
                width: 8,
                height: 15,
                background: cursor ? "#f3eff5" : "transparent",
              }}
            />
          </div>
          <div
            style={{
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "#727077",
              fontSize: 10.2,
            }}
          >
            <span>~/Documents/workspace/opencandle (main)</span>
            <span>OpenCandle · local session · {motion.modelLabel}</span>
          </div>
          <div
            style={{
              height: 20,
              overflow: "hidden",
              whiteSpace: "nowrap",
              color: "#ddd9df",
              fontSize: 9.6,
              fontWeight: 700,
              letterSpacing: 0.05,
            }}
          >
            OpenCandle is a research and analysis tool, not financial advice or a fiduciary financial advisor. Views, targets, and allocations are informational.
          </div>
        </div>
        </div>
      </div>
      </div>
    </AbsoluteFill>
  );
};
