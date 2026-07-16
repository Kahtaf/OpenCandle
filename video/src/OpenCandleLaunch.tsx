import {Audio} from "@remotion/media";
import {AbsoluteFill, Sequence, staticFile} from "remotion";
import pipeline from "../pipeline/launch-pipeline.json";
import {PipelineBeatScene} from "./pipeline/LaunchPipeline";
import {colors} from "./theme";

export const OpenCandleLaunch: React.FC = () => (
  <AbsoluteFill style={{background: colors.black}}>
    <Audio src={staticFile(pipeline.audio.file)} volume={1} />
    {pipeline.beats.map((beat) => (
      <Sequence
        key={beat.id}
        name={beat.id}
        from={beat.from}
        durationInFrames={beat.duration}
        premountFor={30}
      >
        <PipelineBeatScene beat={beat} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
