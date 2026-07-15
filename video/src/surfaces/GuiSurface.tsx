import type {CSSProperties, ReactNode} from "react";
import {
  Activity,
  ArrowUp,
  Bell,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Layers,
  LineChart,
  ListPlus,
  MousePointer2,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {Video} from "@remotion/media";
import {AbsoluteFill, Easing, Img, Interactive, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import motion from "../../motion/gui-interaction.json";

const ui = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const mono = '"SFMono-Regular", Menlo, Monaco, Consolas, monospace';
const viewportScale = 1920 / 1152;
const userPrompt = "I have $50k to invest for 5+ years and already own AAPL and TSLA. Does adding NVDA make sense right now, and what should I be worried about?";
const finalAnswerText = `Research complete.

NVDA shows strong long-term demand, but the near-term setup is mixed.

• AI and data-center demand support the long-term case
• Price sits below SMA(20) and SMA(50)
• RSI is neutral; MACD remains bearish

Options activity is call-heavy, with a 0.70 put/call ratio.

Consider a gradual entry—and verify portfolio concentration before sizing.`;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const events = motion.events;

const C = {
  bg: "#ffffff",
  fg: "#18181b",
  secondary: "#f4f4f5",
  tertiary: "#e8e8eb",
  muted: "#71717a",
  border: "#e4e4e7",
  amber: "#b8680e",
  amberBg: "#fff5df",
  green: "#16803b",
};

const fade = (frame: number, start: number, distance = 8): CSSProperties => ({
  opacity: interpolate(frame, [start, start + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  }),
  translate: `0 ${interpolate(frame, [start, start + 12], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  })}px`,
});

const IconBox = ({children}: {children: ReactNode}) => (
  <span
    style={{
      width: 28,
      height: 28,
      flex: "0 0 auto",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid #ecc06e",
      borderRadius: 7,
      background: C.amberBg,
      color: C.amber,
      fontSize: 15,
      fontWeight: 700,
    }}
  >
    {children}
  </span>
);

const NavRow = ({icon: Icon, children, active = false}: {icon: LucideIcon; children: ReactNode; active?: boolean}) => (
  <div
    style={{
      height: 32,
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "0 8px",
      borderRadius: 7,
      background: active ? "#e9e9ec" : "transparent",
      color: active ? C.fg : "#53535a",
      fontSize: 13.2,
      fontWeight: active ? 550 : 450,
    }}
  >
    <Icon size={16} strokeWidth={1.8} style={{flex: "0 0 auto", color: "#5d5d64"}} />
    {children}
  </div>
);

const Sidebar = () => {
  const sessions = [
    "NVDA investment decision",
    "Market update for my portfolio",
    "Compare AAPL and MSFT",
    "What changed in the 10-Q?",
  ];
  return (
    <aside
      style={{
        width: 200,
        flex: "0 0 200px",
        background: C.secondary,
        borderRight: `1px solid ${C.border}`,
        padding: "11px 10px",
      }}
    >
      <div style={{height: 28, display: "flex", alignItems: "center", gap: 8, padding: "0 4px", marginBottom: 12}}>
        <Img src={staticFile("logo.svg")} style={{width: 22, height: 22, borderRadius: 5}} />
        <span style={{fontWeight: 650, fontSize: 15, letterSpacing: -0.2}}>OpenCandle</span>
        <PanelLeft size={16} strokeWidth={1.8} style={{marginLeft: "auto", color: C.muted}} />
      </div>

      <div
        style={{
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          border: `1px solid ${C.border}`,
          borderRadius: 7,
          background: C.bg,
          fontSize: 14,
          fontWeight: 500,
          boxShadow: "0 1px 2px rgba(15,15,15,.025)",
        }}
      >
        <Plus size={17} strokeWidth={1.8} /> New chat
      </div>

      <div
        style={{
          height: 38,
          marginTop: 9,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 11px",
          border: `1px solid ${C.border}`,
          borderRadius: 7,
          background: C.bg,
          color: C.muted,
          fontSize: 14,
        }}
      >
        <Search size={16} strokeWidth={1.8} /> Search
      </div>

      <div style={{marginTop: 18, padding: "0 8px 5px", color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.55}}>MARKET STATE</div>
      <NavRow icon={ListPlus}>Watchlists</NavRow>
      <NavRow icon={BriefcaseBusiness}>Portfolios</NavRow>
      <NavRow icon={Bell}>Alerts</NavRow>
      <NavRow icon={FileText}>Reports</NavRow>
      <NavRow icon={ClipboardCheck}>Diagnostics</NavRow>

      <div style={{marginTop: 17, padding: "0 8px 6px", color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.55}}>TODAY</div>
      {sessions.map((session, index) => (
        <div
          key={session}
          style={{
            height: 35,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            borderRadius: 7,
            color: index === 0 ? C.fg : C.muted,
            background: index === 0 ? "#e8e8eb" : "transparent",
            fontSize: 13,
          }}
        >
          {session}
        </div>
      ))}
      <div style={{marginTop: 17, padding: "0 8px 6px", color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.55}}>YESTERDAY</div>
      <div style={{padding: "7px 10px", color: C.muted, fontSize: 13}}>Rate cuts and small caps</div>
      <div style={{padding: "7px 10px", color: C.muted, fontSize: 13}}>Review earnings watchlist</div>
    </aside>
  );
};

const ResearchCard = ({frame, active}: {frame: number; active: boolean}) => {
  const complete = frame >= events.researchComplete;
  const completedSteps = Math.max(1, Math.min(6, Math.floor(interpolate(frame, [events.researchReady, events.researchComplete], [1, 6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }))));

  return (
    <Interactive.Div name="Research and analysis row" style={{...fade(frame, events.researchReady), width: "100%", maxWidth: 520}}>
    <div style={{fontSize: 11, color: C.muted, marginBottom: 7}}>Answer</div>
    <div
      style={{
        height: 60,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 13px",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: active ? C.secondary : C.bg,
        boxShadow: active
          ? "0 0 0 2px rgba(184,104,14,.10), 0 1px 2px rgba(15,15,15,.04)"
          : "0 1px 2px rgba(15,15,15,.04)",
      }}
    >
      <IconBox>⌁</IconBox>
      <div style={{minWidth: 0}}>
        <div style={{fontSize: 14, fontWeight: 550}}>Research &amp; analysis</div>
        <div style={{fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 5}}>
          {complete ? (
            <span data-research-status="complete">6 of 6 steps · 9 sources</span>
          ) : (
            <>
              <span data-research-status="working" style={{display: "inline-flex", alignItems: "center", gap: 5}}>
                <span style={{width: 7, height: 7, borderRadius: 7, background: C.green, boxShadow: "0 0 0 3px #e7f5eb"}} />
                Working…
              </span>
              <span>· {completedSteps} of 6 steps</span>
            </>
          )}
        </div>
      </div>
      <div style={{marginLeft: "auto", display: "flex", alignItems: "center", gap: 10}}>
        <div style={{display: "flex", alignItems: "center", gap: 7, padding: "4px 9px", border: `1px solid ${C.border}`, borderRadius: 16, fontSize: 11}}>
          <span style={{display: "inline-flex", marginRight: 2}}>{["#11a842", "#6f5669", "#11a842"].map((color, index) => <i key={color + index} style={{width: 14, height: 14, marginLeft: index ? -4 : 0, border: "2px solid white", borderRadius: 14, background: color}} />)}</span> 9 sources
        </div>
        <div style={{padding: "4px 9px", border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11}}>{complete ? "6 steps" : "Working…"}</div>
        <ChevronRight size={17} strokeWidth={1.8} style={{color: C.muted}} />
      </div>
    </div>
    </Interactive.Div>
  );
};

const Answer = ({frame}: {frame: number}) => {
  if (frame < events.finalTypingStart) return null;
  const typedLength = Math.floor(interpolate(frame, [events.finalTypingStart, events.finalTypingEnd], [0, finalAnswerText.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  }));
  const caretVisible = frame < events.finalTypingEnd && frame % 20 < 13;

  return (
    <div data-final-answer style={{...fade(frame, events.finalTypingStart, 5), width: "100%", maxWidth: 520, fontSize: 12.9, lineHeight: 1.48, color: "#3f3f46", whiteSpace: "pre-wrap"}}>
      {finalAnswerText.slice(0, typedLength)}
      {caretVisible ? <span style={{display: "inline-block", width: 1.5, height: 14, marginLeft: 2, verticalAlign: -2, background: C.fg}} /> : null}
    </div>
  );
};

const Composer = ({frame, typedLength}: {frame: number; typedLength: number}) => {
  const submitted = frame >= events.sendClick + 4;
  const focused = frame >= events.composerClick && !submitted;
  const cursorVisible = frame % 20 < 13;
  const typed = submitted ? "" : userPrompt.slice(0, typedLength);
  const canSend = typedLength > 0 && !submitted;
  const modelFocus = interpolate(
    frame,
    [events.modelFocusStart, events.modelFocusStart + 14, events.modelFocusEnd - 14, events.modelFocusEnd],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease},
  );

  return (
    <Interactive.Div
      name="Prompt composer"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 18,
        translate: "-50% 0",
        width: 520,
        height: 104,
        border: focused ? "1px solid rgba(184,104,14,.52)" : `1px solid ${C.border}`,
        borderRadius: 16,
        background: C.bg,
        boxShadow: focused
          ? "0 0 0 3px rgba(184,104,14,.08), 0 8px 24px rgba(15,15,15,.06)"
          : "0 1px 2px rgba(15,15,15,.04)",
        overflow: "hidden",
      }}
    >
      <div style={{height: 66, padding: "12px 14px", color: typed ? C.fg : C.muted, fontSize: 12.6, lineHeight: 1.38}}>
        {typed || "Ask anything"}
        {focused ? (
          <span style={{display: "inline-block", width: 1.5, height: 14, marginLeft: 2, verticalAlign: -2, background: C.fg, opacity: cursorVisible ? 1 : 0}} />
        ) : null}
      </div>
      <div style={{height: 38, borderTop: `1px dashed ${C.border}`, display: "flex", alignItems: "center", padding: "0 9px", gap: 10}}>
        <div
          data-motion-name="Model selector"
          style={{
            height: 27,
            display: "flex",
            alignItems: "center",
            padding: "0 9px",
            border: `1px solid ${modelFocus > 0.01 ? `rgba(184,104,14,${0.25 + modelFocus * 0.55})` : C.border}`,
            borderRadius: 6,
            background: C.secondary,
            boxShadow: `0 0 0 ${3 * modelFocus}px rgba(184,104,14,${0.12 * modelFocus})`,
            fontFamily: mono,
            fontSize: 10.5,
            scale: 1 + modelFocus * 0.035,
          }}
        >
          {motion.modelLabel}⌄
        </div>
        <Plus size={16} strokeWidth={1.8} style={{color: C.muted}} />
        <span style={{color: C.muted, fontSize: 16}}>♧</span>
        <div
          style={{
            marginLeft: "auto",
            width: 31,
            height: 31,
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: canSend ? C.fg : C.secondary,
            color: canSend ? C.bg : "#8b8b92",
            scale: interpolate(frame, [events.sendClick - 2, events.sendClick, events.sendClick + 3], [1, 0.88, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <ArrowUp size={17} strokeWidth={1.8} />
        </div>
      </div>
    </Interactive.Div>
  );
};

const ToolCardShell = ({children}: {children: ReactNode}) => (
  <div style={{border: `1px solid ${C.border}`, borderRadius: 7, background: C.bg, padding: "12px 13px"}}>{children}</div>
);

const Tag = ({children}: {children: ReactNode}) => (
  <span style={{display: "inline-flex", alignItems: "center", height: 19, padding: "0 6px", borderRadius: 5, background: C.secondary, color: C.muted, fontSize: 9.5}}>{children}</span>
);

const MoneyTile = ({label, value}: {label: string; value: string}) => (
  <div style={{minHeight: 51, borderRadius: 6, background: C.secondary, padding: "8px 9px"}}>
    <div style={{color: C.muted, fontSize: 8.5, letterSpacing: 0.55, lineHeight: 1.35}}>{label}</div>
    <div style={{marginTop: 4, fontSize: 11.5, fontWeight: 500, fontVariantNumeric: "tabular-nums"}}>{value}</div>
  </div>
);

const SourceStrip = ({frame, start}: {frame?: number; start?: number} = {}) => {
  const sources = [
    {domain: "humilitas.org", title: "Nvidia's Earnings: Can...", mark: "●", color: "#11a842"},
    {domain: "bitrss.com", title: "Nvidia (NVDA) Crushes...", mark: "Bᵗ", color: "#6f5669"},
    {domain: "1618arts.com", title: "Nvidia Earnings, AI...", mark: "●", color: "#11a842"},
  ];
  return (
    <div style={{padding: "0 10px 12px"}}>
      <div style={{marginBottom: 7, color: C.muted, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.75}}>SOURCES</div>
      <div style={{display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6}}>
        {sources.map((source, index) => {
          const reveal = frame === undefined || start === undefined
            ? 1
            : interpolate(frame, [start + index * 2, start + 6 + index * 2], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: ease,
              });
          return (
            <div
              key={source.domain}
              style={{
                height: 74,
                minWidth: 0,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "7px 7px 6px",
                overflow: "hidden",
                opacity: reveal,
                translate: `0 ${interpolate(reveal, [0, 1], [12, 0])}px`,
                scale: interpolate(reveal, [0, 1], [0.97, 1]),
                transformOrigin: "bottom center",
              }}
            >
              <div style={{display: "flex", alignItems: "center", gap: 4, color: C.muted, fontSize: 8.7, whiteSpace: "nowrap"}}>
                <span style={{color: source.color, fontWeight: 700}}>{source.mark}</span>{source.domain}
              </div>
              <div style={{marginTop: 5, fontSize: 10.2, lineHeight: 1.35}}>{source.title}</div>
            </div>
          );
        })}
        <div
          style={{
            height: 74,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            background: C.secondary,
            padding: "10px 8px",
            color: C.muted,
            fontSize: 10.2,
            opacity: frame === undefined || start === undefined
              ? 1
              : interpolate(frame, [start + 6, start + 14], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: ease,
                }),
            translate: frame === undefined || start === undefined
              ? "0 0"
              : `0 ${interpolate(frame, [start + 6, start + 14], [12, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: ease,
                })}px`,
          }}
        >
          <div style={{letterSpacing: -3, marginBottom: 13}}>🌐🌐🌐</div>
          +6 sources
        </div>
      </div>
    </div>
  );
};

const StockQuoteCard = () => (
  <ToolCardShell>
    <div style={{display: "flex", alignItems: "baseline", gap: 10}}>
      <span style={{fontFamily: mono, color: C.muted, fontSize: 10.5}}>NVDA</span>
      <strong style={{fontSize: 29, letterSpacing: -1.1}}>$194.83</strong>
      <span style={{color: "#ef4444", fontSize: 12}}>↓ $2.75 · 1.39%</span>
    </div>
    <div style={{marginTop: 2, color: C.muted, fontSize: 10.2}}>
      <div>Prev close $197.58</div>
      <div style={{marginTop: 2}}>Recorded 2026-07-04 · 06:31 ET</div>
    </div>
    <div style={{display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginTop: 12}}>
      {[["OPEN", "$197.14"], ["HIGH", "$200.06"], ["LOW", "$192.35"], ["VOLUME", "129.94M"]].map(([label, value]) => <MoneyTile key={label} label={label} value={value} />)}
    </div>
    <div style={{marginTop: 12}}>
      <div style={{display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 9}}> <span>52-WEEK RANGE</span><span>47%</span></div>
      <div style={{position: "relative", height: 4, marginTop: 7, borderRadius: 3, background: C.secondary}}><span style={{position: "absolute", left: "47%", top: -4, width: 1.5, height: 12, background: C.fg}} /></div>
      <div style={{display: "flex", justifyContent: "space-between", marginTop: 6, color: C.muted, fontSize: 9.2}}><span>$157.34</span><span>$236.54</span></div>
    </div>
    <div style={{display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginTop: 12}}>
      <MoneyTile label="MARKET CAP" value="$4.72T" /><MoneyTile label="P/E" value="29.88" /><MoneyTile label="AS OF" value="6:31:23 AM" />
    </div>
  </ToolCardShell>
);

const CompanyOverviewCard = () => (
  <ToolCardShell>
    <div style={{display: "flex", alignItems: "center", gap: 7}}><strong style={{fontSize: 13}}>NVIDIA Corporation</strong><span style={{fontFamily: mono, color: C.muted, fontSize: 9.5}}>NVDA</span><span style={{border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 5px", fontSize: 8.5}}>NASDAQ</span></div>
    <div style={{marginTop: 6, color: C.muted, fontSize: 9.5}}>TECHNOLOGY · SEMICONDUCTORS</div>
    <p style={{margin: "11px 0", color: C.muted, fontSize: 10.7, lineHeight: 1.5}}>Nvidia designs graphics processing units and accelerated computing platforms for data centers, gaming, and professional markets.</p>
    <div style={{display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7}}>
      {[["MARKET CAP", "$4.72T"], ["P/E", "29.88"], ["FORWARD P/E", "22.52"], ["EPS", "6.52"], ["BETA", "2.20"], ["DIVIDEND YIELD", "0.02%"], ["PROFIT MARGIN", "63.00%"], ["REVENUE GROWTH", "85.20%"], ["AVG VOLUME", "Unavailable"]].map(([label, value]) => <MoneyTile key={label} label={label} value={value} />)}
    </div>
    <div style={{marginTop: 9, color: C.muted, fontSize: 9.5}}>52-week range $157.13 – $236.26</div>
  </ToolCardShell>
);

const priceSeries = [162,168,173,166,177,181,175,169,184,188,179,187,182,176,185,191,188,196,205,198,193,202,207,199,194,203,208,211,205,198,207,214,210,201,192,187,199,205,212,208,216,228,219,234,224,217,229,220,213,205,198];
const sma20Series = priceSeries.map((_, index) => 170 + index * 0.82 + Math.sin(index / 5) * 4);
const sma50Series = priceSeries.map((_, index) => 173 + index * 0.69 + Math.sin(index / 8) * 2);
const rsiSeries = [42,48,51,43,39,46,52,56,49,44,53,58,47,45,51,60,55,48,52,57,50,46,54,49,43,47,52,58,55,49,45,51,57,62,55,48,44,52,59,64,61,53,49,55,60,52,47,45,43,41,41.2];
const macdBars = [-3,-2,-1,1,2,1,-1,-2,-3,-1,2,3,2,1,-1,-3,-2,1,3,4,2,-1,-2,-1,1,2,1,-1,-2,-3,-2,1,3,4,3,1,-1,-2,-1,2,4,5,3,1,-1,-2,-3,-4,-3,-2,-1];

const linePath = (values: number[], width: number, height: number, min: number, max: number) => values.map((value, index) => {
  const x = index / (values.length - 1) * width;
  const y = 4 + (1 - (value - min) / (max - min || 1)) * (height - 8);
  return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(" ");

const bandAreaPath = (upper: number[], lower: number[], width: number, height: number, min: number, max: number) => {
  const point = (value: number, index: number) => {
    const x = index / (upper.length - 1) * width;
    const y = 4 + (1 - (value - min) / (max - min || 1)) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const top = upper.map((value, index) => `${index === 0 ? "M" : "L"}${point(value, index)}`).join(" ");
  const bottom = lower.map((_, reverseIndex) => {
    const index = lower.length - 1 - reverseIndex;
    return `L${point(lower[index], index)}`;
  }).join(" ");
  return `${top} ${bottom} Z`;
};

const ChartHeader = ({label, legend, value}: {label: string; legend?: ReactNode; value?: string}) => (
  <div style={{height: 24, display: "flex", alignItems: "center", gap: 7, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 8.6}}>
    <span style={{letterSpacing: 0.45}}>{label}</span>{legend}<span style={{marginLeft: "auto"}}>{value}</span>
  </div>
);

const Legend = ({items}: {items: Array<[string, string]>}) => <span style={{display: "inline-flex", gap: 7}}>{items.map(([color, label]) => <span key={label} style={{display: "inline-flex", alignItems: "center", gap: 3}}><i style={{display: "inline-block", width: 10, height: 2, borderRadius: 2, background: color}} />{label}</span>)}</span>;

const TechnicalIndicatorsCard = ({frame, start}: {frame: number; start: number}) => {
  const progress = interpolate(frame, [start, start + 28], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease});
  const width = 340;
  const priceHeight = 116;
  const rsiHeight = 45;
  const macdHeight = 52;
  const minPrice = 156.95;
  const maxPrice = 235.74;
  const pricePath = linePath(priceSeries, width, priceHeight, minPrice, maxPrice);
  const upper = sma20Series.map((value) => value + 12);
  const lower = sma20Series.map((value) => value - 12);
  const bandPath = bandAreaPath(upper, lower, width, priceHeight, minPrice, maxPrice);
  const rsiPath = linePath(rsiSeries, width, rsiHeight, 0, 100);
  const macdLine = macdBars.map((value, index) => value + Math.sin(index / 2) * 1.2);
  const signalLine = macdBars.map((value, index) => value * 0.75 + Math.sin(index / 3));
  return (
    <div data-research-card="rsi" style={{border: `1px solid ${C.border}`, borderRadius: 7, background: C.bg, padding: "12px 13px"}}>
      <div style={{fontSize: 10.7, lineHeight: 1.5}}>
        <strong>NVDA Technical Analysis</strong>
        <div style={{color: C.muted, fontSize: 8.7, letterSpacing: 0.2}}>Recorded values · illustrative chart</div>
        <span>(2025-07-03 to 2026-07-02) Price: $194.83</span><br />SMA(20): $203.48 | SMA(50): $209.80 RSI(14): 41.2 (Neutral)
      </div>
      <div style={{display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 10, padding: "8px 9px", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 9.2}}><span>MACD: -4.09</span><span>Signal: -3.09</span><span>Histogram: -1.00</span></div>
      <p style={{margin: "9px 0 10px", fontSize: 9.5, lineHeight: 1.45}}>Signals: Price below SMA(20) — short-term bearish | Death cross pattern | MACD bearish | Volume confirming decline</p>
      <ChartHeader label="PRICE" value="$156.95 – $235.74" legend={<Legend items={[[C.fg,"Close"],["#3b82f6","SMA(20)"],["#d97706","SMA(50)"],["#d4d4d8","Bollinger"]]} />} />
      <svg data-research-chart="price" width="100%" height={priceHeight} viewBox={`0 0 ${width} ${priceHeight}`} preserveAspectRatio="none" aria-label="Price, moving average, and Bollinger band chart">
        <path d={bandPath} fill="rgba(24,24,27,.06)" />
        <path d={linePath(sma50Series,width,priceHeight,minPrice,maxPrice)} fill="none" stroke="#d97706" strokeWidth="1" pathLength={1} strokeDasharray={1} strokeDashoffset={1-progress} />
        <path d={linePath(sma20Series,width,priceHeight,minPrice,maxPrice)} fill="none" stroke="#3b82f6" strokeWidth="1" pathLength={1} strokeDasharray={1} strokeDashoffset={1-progress} />
        <path d={pricePath} fill="none" stroke={C.fg} strokeWidth="1.5" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1-progress} />
      </svg>
      <div style={{display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 8}}><span data-chart-axis-label="start">Jul 2025</span><span data-chart-axis-label="latest">Latest</span></div>
      <ChartHeader label="RSI(14)" value="41.2" />
      <svg data-research-chart="rsi" width="100%" height={rsiHeight} viewBox={`0 0 ${width} ${rsiHeight}`} preserveAspectRatio="none" aria-label="RSI chart">
        <line x1="0" x2={width} y1={rsiHeight*.3} y2={rsiHeight*.3} stroke="#d97706" strokeOpacity=".5" strokeDasharray="2 2" />
        <line x1="0" x2={width} y1={rsiHeight*.7} y2={rsiHeight*.7} stroke="#3b82f6" strokeOpacity=".5" strokeDasharray="2 2" />
        <path d={rsiPath} fill="none" stroke={C.fg} strokeWidth="1.35" pathLength={1} strokeDasharray={1} strokeDashoffset={1-progress} />
      </svg>
      <ChartHeader label="MACD" value="-4.09 / -3.09" legend={<Legend items={[[C.fg,"MACD"],["#d97706","Signal"],["#a1a1aa","Histogram"]]} />} />
      <svg data-research-chart="macd" width="100%" height={macdHeight} viewBox={`0 0 ${width} ${macdHeight}`} preserveAspectRatio="none" aria-label="MACD chart">
        {macdBars.map((value,index) => {const barW=width/macdBars.length; const h=Math.abs(value)*3*progress; return <rect key={index} x={index*barW} y={value>=0?macdHeight/2-h:macdHeight/2} width={Math.max(1,barW-1)} height={h} fill={value>=0?"#86d4a3":"#fca5a5"} />;})}
        <path d={linePath(macdLine,width,macdHeight,-7,7)} fill="none" stroke={C.fg} strokeWidth="1.2" />
        <path d={linePath(signalLine,width,macdHeight,-7,7)} fill="none" stroke="#d97706" strokeWidth="1" strokeDasharray="3 2" />
      </svg>
    </div>
  );
};

const WebSearchCard = () => (
  <ToolCardShell>
    <div style={{fontSize: 10.5}}>“NVDA earnings context market” <span style={{color: C.muted}}>· 9 results · via exa</span></div>
    <div style={{display: "flex", flexWrap: "wrap", gap: 5, margin: "9px 0 7px"}}>{["humilitas", "bitrss", "1618arts", "fxleaders", "seekingalpha", "kalkine"].map((site) => <span key={site} style={{border: `1px solid ${C.border}`, borderRadius: 10, padding: "2px 7px", fontSize: 8.5}}>● {site}</span>)}</div>
    {["Nvidia's Earnings: Can AI Powerhouse Overcome Bond...", "Nvidia (NVDA) Crushes Earnings as Bitcoin Miners Benefit...", "Nvidia Earnings, AI Disruption: Market Outlook and Stock..."].map((title,index) => <div key={title} style={{display: "grid", gridTemplateColumns: "18px 1fr", gap: 6, padding: "8px 0", borderTop: index ? `1px solid ${C.border}` : "none"}}><span style={{color: index===1?"#6f5669":C.green}}>●</span><div><div style={{fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{title}</div><div style={{marginTop: 4, color: C.muted, fontSize: 8.7, lineHeight: 1.4}}>Latest market context and earnings coverage from the source...</div><div style={{marginTop: 4, color: C.muted, fontSize: 8.3}}>{index===1?"bitrss.com":"humilitas.org"} · Jul {index+3}, 2026 <span style={{border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 4px", color: C.fg}}>news</span></div></div></div>)}
  </ToolCardShell>
);

const ContractList = ({title, rows}: {title: string; rows: Array<[string,string,string]>}) => (
  <div style={{border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden"}}>
    <div style={{height: 25, display: "flex", alignItems: "center", padding: "0 9px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 8.7, letterSpacing: .5}}>{title}</div>
    {rows.map(([strike,last,iv]) => <div key={strike} style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, padding: "7px 9px", borderBottom: `1px solid ${C.border}`, fontSize: 9.2}}><span>{strike}</span><span style={{color: C.muted}}>last<br />{last}</span><span style={{color: C.muted, textAlign: "right"}}>IV {iv}</span></div>)}
  </div>
);

const OptionsChainCard = ({frame, start}: {frame: number; start: number}) => {
  const progress = interpolate(frame, [start, start + 20], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease});
  return (
    <div data-research-card="options-interest"><ToolCardShell>
      <div style={{display: "flex", alignItems: "baseline", gap: 9}}><span style={{fontFamily: mono, fontSize: 10.5}}>NVDA</span><strong style={{fontSize: 17}}>$194.83</strong><span style={{color: C.muted, fontSize: 9.5}}>underlying</span></div>
      <div style={{marginTop: 5, color: C.muted, fontSize: 9.5}}>Expiration Jul 17 · 20 dates available</div>
      <div style={{marginTop: 12, display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 8.8}}><span>Calls 115.9K</span><span>Puts 81.0K</span></div>
      <div data-options-stack-bar style={{height: 7, marginTop: 5, display: "flex", borderRadius: 7, overflow: "hidden"}}><span style={{width: `${59*progress}%`, background: "#16a34a"}} /><span style={{width: `${41*progress}%`, background: "#ef4444"}} /></div>
      <div style={{marginTop: 9, color: C.muted, fontSize: 8.8}}>Put/Call ratio <span style={{color: C.fg}}>0.70</span></div>
      <div style={{display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginTop: 11}}><MoneyTile label="AVG IV" value="148.1%" /><MoneyTile label="CALL CONTRACTS" value="103" /><MoneyTile label="PUT CONTRACTS" value="77" /><MoneyTile label="TOTAL VOLUME" value="196.9K" /></div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 10}}>
        <ContractList title="OTM CALLS" rows={[["$195.00","$6.00","40%"],["$197.50","$4.75","39%"],["$200.00","$3.65","38%"],["$202.50","$2.79","38%"]]} />
        <ContractList title="OTM PUTS" rows={[["$15.00","$0.0100","394%"],["$17.50","$0.0100","375%"],["$20.00","$0.0300","350%"],["$30.00","$0.0100","288%"]]} />
      </div>
    </ToolCardShell></div>
  );
};

const ToolIconBox = ({icon: Icon}: {icon: LucideIcon}) => <span style={{width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #edb95f", borderRadius: 5, background: C.amberBg, color: C.amber}}><Icon size={12} strokeWidth={1.6} /></span>;

const ToolStep = ({title, args, icon, children, frame, start, last = false}: {title: string; args: string[]; icon: LucideIcon; children: ReactNode; frame: number; start: number; last?: boolean}) => (
  <li style={{...fade(frame, start, 4), display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", listStyle: "none"}}>
    <div style={{position: "relative", display: "flex", flexDirection: "column", alignItems: "center"}}><div style={{height: 18, display: "flex", alignItems: "center"}}><span style={{width: 6, height: 6, borderRadius: 6, background: "#111"}} /></div>{!last ? <div style={{flex: 1, borderLeft: `1px dashed ${C.border}`}} /> : null}</div>
    <div style={{paddingBottom: 18, minWidth: 0}}>
      <div style={{display: "flex", gap: 6, alignItems: "center"}}><ToolIconBox icon={icon} /><span style={{fontSize: 11.5, fontWeight: 500}}>{title}</span><CheckCircle2 size={11} strokeWidth={1.6} color={C.muted} /><span style={{marginLeft: -3, color: C.muted, fontSize: 9.2}}>Completed</span></div>
      <div style={{display: "flex", flexWrap: "wrap", gap: 4, margin: "5px 0 8px"}}>{args.map((arg) => <Tag key={arg}>{arg}</Tag>)}</div>
      {children}
      <div style={{marginTop: 8, color: "#9a9aa2", fontSize: 8.7, letterSpacing: .55}}>› RAW INPUT · OUTPUT</div>
    </div>
  </li>
);

const SecFilingsCard = () => {
  const filings = [
    ["8-K", "Period 2026-06-02", "Jun 4, 2026"],
    ["8-K", "Period 2026-05-13", "May 13, 2026"],
    ["10-Q", "Period 2026-03-31", "Apr 28, 2026"],
    ["8-K", "Period 2026-04-29", "Apr 28, 2026"],
    ["10-Q", "Period 2025-12-31", "Jan 27, 2026"],
  ];

  return (
    <ToolCardShell>
      <div style={{fontSize: 10.5}}><strong>MSFT</strong> <span style={{color: C.muted}}>· MICROSOFT CORP · 10 filings</span></div>
      <div style={{marginTop: 10}}>
        {filings.map(([form, period, filed], index) => (
          <div
            key={`${form}-${period}`}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 40px minmax(0,1fr) 72px",
              gap: 7,
              alignItems: "center",
              minHeight: 45,
              borderTop: index ? `1px solid ${C.border}` : "none",
              fontSize: 9.5,
            }}
          >
            <span style={{color: "#b8c7df"}}>◉</span>
            <span style={{padding: "2px 5px", border: `1px solid ${C.border}`, borderRadius: 4, textAlign: "center"}}>{form}</span>
            <span>{period}</span>
            <span style={{color: C.muted, textAlign: "right"}}>{filed}</span>
          </div>
        ))}
      </div>
    </ToolCardShell>
  );
};

const featurePanelOpacity = (frame: number, start: number, end: number) => interpolate(
  frame,
  [start, start + 6, end - 6, end],
  [0, 1, 1, 0],
  {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease},
);

const FeatureToolSpotlight = ({frame}: {frame: number}) => {
  const panels = [
    {
      key: "quote",
      start: events.featureTourStart,
      end: events.quoteFocusEnd,
      content: (
        <ToolStep title="Stock quote" args={["symbol  NVDA"]} icon={LineChart} frame={events.featureTourStart + 20} start={events.featureTourStart} last>
          <StockQuoteCard />
        </ToolStep>
      ),
    },
    {
      key: "filings",
      start: events.filingsFocusStart,
      end: events.filingsFocusEnd,
      content: (
        <ToolStep title="SEC filings" args={["symbol  MSFT"]} icon={FileText} frame={events.filingsFocusStart + 20} start={events.filingsFocusStart} last>
          <SecFilingsCard />
        </ToolStep>
      ),
    },
    {
      key: "indicators",
      start: events.indicatorsFocusStart,
      end: events.indicatorsFocusEnd,
      content: (
        <ToolStep title="Technical indicators" args={["symbol  NVDA", "range  1y"]} icon={Activity} frame={events.indicatorsFocusStart + 28} start={events.indicatorsFocusStart} last>
          <TechnicalIndicatorsCard frame={events.indicatorsFocusStart + 28} start={events.indicatorsFocusStart} />
        </ToolStep>
      ),
    },
    {
      key: "options",
      start: events.optionsFocusStart,
      end: events.toolFocusEnd,
      content: (
        <ToolStep title="Options chain" args={["expiration  2026-07-17", "symbol  NVDA"]} icon={Layers} frame={events.optionsFocusStart + 24} start={events.optionsFocusStart} last>
          <OptionsChainCard frame={events.optionsFocusStart + 24} start={events.optionsFocusStart} />
        </ToolStep>
      ),
    },
    {
      key: "sources",
      start: events.sourceFocusStart,
      end: events.sourceFocusEnd,
      content: <SourceStrip frame={frame} start={events.sourceFocusStart} />,
    },
  ];

  return (
    <div style={{position: "absolute", inset: "57px 0 0", zIndex: 4, pointerEvents: "none", overflow: "hidden"}}>
      {panels.map((panel) => (
        <div
          key={panel.key}
          data-feature-tool={panel.key}
          style={{
            position: "absolute",
            inset: 0,
            padding: panel.key === "sources" ? "14px 0 0" : "12px 8px 0",
            background: C.bg,
            opacity: featurePanelOpacity(frame, panel.start, panel.end),
            translate: `0 ${interpolate(
              frame,
              [panel.start, panel.start + 6, panel.end - 6, panel.end],
              [18, 0, 0, -14],
              {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease},
            )}px`,
            scale: interpolate(
              frame,
              [panel.start, panel.start + 6, panel.end - 6, panel.end],
              [0.985, 1, 1, 0.992],
              {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease},
            ),
            transformOrigin: "center top",
            willChange: "opacity, scale, translate",
            backfaceVisibility: "hidden",
          }}
        >
          {panel.key === "sources" ? panel.content : <ol style={{margin: 0, padding: 0}}>{panel.content}</ol>}
        </div>
      ))}
    </div>
  );
};

const ToolDrawer = ({frame, openProgress}: {frame: number; openProgress: number}) => {
  const drawerWidth = 390;
  const stockStart = events.drawerOpenEnd + 3;
  const companyStart = events.drawerOpenEnd + 18;
  const technicalStart = events.drawerOpenEnd + 44;
  const webStart = events.researchScrollStart + 10;
  const optionsStart = events.researchScrollStart + 32;
  const complete = frame >= events.researchComplete;
  const scrollOffset = interpolate(frame, motion.researchScroll.frames, motion.researchScroll.offsets, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return (
    <div
      style={{
        position: "absolute",
        right: -drawerWidth * (1 - openProgress),
        top: 0,
        zIndex: 5,
        width: drawerWidth,
        height: 648,
        background: C.bg,
        overflow: "hidden",
      }}
    >
      <div
        data-motion-name="Research timeline drawer"
        style={{
          width: drawerWidth,
          height: 648,
          borderLeft: `1px solid ${C.border}`,
          background: C.bg,
          overflow: "hidden",
          boxShadow: openProgress > 0 ? "-18px 0 42px rgba(24,24,27,.05)" : "none",
        }}
      >
        <header style={{height: 57, display: "flex", alignItems: "center", gap: 9, padding: "0 16px", borderBottom: `1px solid ${C.border}`}}>
          <div style={{minWidth: 0, flex: 1}}>
            <div style={{fontSize: 14, fontWeight: 550}}>Research &amp; analysis</div>
            <div style={{fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 6}}>
              <span style={{padding: "1px 5px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9, letterSpacing: .35}}>Recorded demo</span>
              {complete ? "Completed" : <><span style={{width: 7, height: 7, borderRadius: 7, background: C.green, boxShadow: "0 0 0 3px #e7f5eb"}} />Working…</>}
            </div>
          </div>
          <div style={{padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11}}>6 steps</div>
          <span style={{width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, color: C.muted}}>×</span>
        </header>
        <div style={{position: "absolute", inset: "57px 0 0", overflow: "hidden", backgroundColor: "#ffffff"}}>
          <div
            style={{
              padding: "10px 7px 16px",
              translate: `0 -${scrollOffset}px`,
              willChange: "translate",
            }}
          >
            <div style={fade(frame, events.researchClick, 4)}><SourceStrip /></div>
            <ol style={{margin: 0, padding: 0}}>
              <ToolStep title="Stock quote" args={["symbol  NVDA"]} icon={LineChart} frame={frame} start={stockStart}><StockQuoteCard /></ToolStep>
              <ToolStep title="Company overview" args={["symbol  NVDA"]} icon={Building2} frame={frame} start={companyStart}><CompanyOverviewCard /></ToolStep>
              <ToolStep title="Technical indicators" args={["symbol  NVDA", "range  1y"]} icon={Activity} frame={frame} start={technicalStart}><TechnicalIndicatorsCard frame={frame} start={technicalStart} /></ToolStep>
              <ToolStep title="Web search" args={["query  NVDA earnings context...", "category  news"]} icon={Search} frame={frame} start={webStart}><WebSearchCard /></ToolStep>
              <ToolStep title="Options chain" args={["expiration  2026-07-17", "symbol  NVDA"]} icon={Layers} frame={frame} start={optionsStart} last><OptionsChainCard frame={frame} start={optionsStart} /></ToolStep>
            </ol>
          </div>
        </div>
        <FeatureToolSpotlight frame={frame} />
      </div>
    </div>
  );
};

const TerminalHandoff: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0, 18], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        }),
      }}
    >
      <Video
        src={staticFile("approved/tui.mp4")}
        muted
        playbackRate={0.001}
        objectFit="cover"
        style={{width: "100%", height: "100%"}}
      />
    </AbsoluteFill>
  );
};

export const OpenCandleGUI: React.FC<{frameOffset?: number}> = ({frameOffset = 0}) => {
  const frame = useCurrentFrame() + frameOffset;
  const typedLength = Math.floor(interpolate(frame, [events.typingStart, events.typingEnd], [0, userPrompt.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
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
  const pointerX = interpolate(frame, motion.pointer.frames, motion.pointer.x, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const pointerY = interpolate(frame, motion.pointer.frames, motion.pointer.y, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const clickPulseAt = (at: number) => interpolate(frame, [at - 2, at, at + 6], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const clickPulse = Math.max(
    clickPulseAt(events.composerClick),
    clickPulseAt(events.sendClick),
    clickPulseAt(events.researchClick),
    clickPulseAt(events.modelClick),
    clickPulseAt(events.drawerCloseClick),
  );
  const baseDrawerOpen = interpolate(frame, [events.researchClick, events.drawerOpenEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const drawerTourClose = interpolate(frame, [events.drawerCloseClick, events.drawerCloseEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const drawerOpen = baseDrawerOpen * drawerTourClose;
  const messageIn = interpolate(frame, [events.messageIn, events.messageIn + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const initialPointerOpacity = interpolate(frame, [events.researchComplete, events.researchComplete + 12], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tourPointerOpacity = interpolate(
    frame,
    [events.featureTourStart, events.featureTourStart + 10, events.answerFocusEnd - 14, events.answerFocusEnd],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease},
  );
  const pointerOpacity = Math.max(initialPointerOpacity, tourPointerOpacity);
  return (
    <AbsoluteFill style={{fontFamily: ui, background: C.bg, color: C.fg}}>
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
          background: C.bg,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            scale: cameraZoom,
            translate: `${cameraX}px ${cameraY}px`,
            transformOrigin: `${cameraOriginX}px ${cameraOriginY}px`,
            display: "flex",
            overflow: "hidden",
            background: C.bg,
            willChange: "transform, scale, translate",
            backfaceVisibility: "hidden",
          }}
        >
          <Sidebar />
          <main style={{position: "relative", minWidth: 0, flex: 1, marginRight: 390 * drawerOpen, background: C.bg, overflow: "hidden"}}>
          <div style={{position: "absolute", inset: "0 0 118px", overflow: "hidden", padding: "22px 24px"}}>
            <div style={{width: "100%", maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26}}>
              <div
                style={{
                  minHeight: 61,
                  marginLeft: "auto",
                  width: 465,
                  padding: "10px 13px",
                  borderRadius: 16,
                  background: C.secondary,
                  fontSize: 13,
                  lineHeight: 1.42,
                  opacity: messageIn,
                  translate: `0 ${interpolate(messageIn, [0, 1], [12, 0])}px`,
                }}
              >
                {userPrompt}
              </div>
              <ResearchCard frame={frame} active={drawerOpen > 0.5} />
              <Answer frame={frame} />
            </div>
          </div>
          <Composer frame={frame} typedLength={typedLength} />
          </main>
          <ToolDrawer frame={frame} openProgress={drawerOpen} />
          <Interactive.Div
          name="Demonstration cursor"
          style={{
            position: "absolute",
            left: pointerX,
            top: pointerY,
            zIndex: 20,
            opacity: pointerOpacity,
            filter: "drop-shadow(0 2px 2px rgba(0,0,0,.22))",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: -10,
              top: -10,
              width: 28,
              height: 28,
              border: "1.5px solid rgba(24,24,27,.45)",
              borderRadius: 28,
              opacity: clickPulse,
              scale: interpolate(clickPulse, [0, 1], [0.45, 1.35]),
            }}
          />
          <MousePointer2 size={21} strokeWidth={1.8} fill="#ffffff" color="#18181b" />
          </Interactive.Div>
        </div>
      </div>
      <Sequence
        from={events.terminalHandoffStart - frameOffset}
        durationInFrames={motion.durationFrames - events.terminalHandoffStart}
      >
        <TerminalHandoff />
      </Sequence>
    </AbsoluteFill>
  );
};

export const OpenCandleGUIFeatureTour: React.FC = () => <OpenCandleGUI frameOffset={events.featureTourStart} />;
