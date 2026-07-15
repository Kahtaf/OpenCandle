import "./index.css";
import {Composition} from "remotion";
import {OpenCandleLaunch} from "./OpenCandleLaunch";
import {OpenCandleGUI, OpenCandleGUIFeatureTour} from "./surfaces/GuiSurface";
import {OpenCandleTUI} from "./surfaces/TuiSurface";
import pipeline from "../pipeline/launch-pipeline.json";
import guiMotion from "../motion/gui-interaction.json";
import tuiMotion from "../motion/tui-interaction.json";
import {fps} from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="OpenCandleTUI"
      component={OpenCandleTUI}
      durationInFrames={tuiMotion.durationFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="OpenCandleGUI"
      component={OpenCandleGUI}
      durationInFrames={guiMotion.durationFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="OpenCandleArchitecture"
      component={OpenCandleGUIFeatureTour}
      durationInFrames={pipeline.assets.architecture.durationFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="OpenCandleLaunch"
      component={OpenCandleLaunch}
      durationInFrames={pipeline.totalFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
  </>
);
