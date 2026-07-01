import { OpenCandleLogo as SharedOpenCandleLogo } from "@opencandle/ui/logo";
import logoUrl from "../../../../../assets/logo.svg";

export function OpenCandleLogo(props) {
  return <SharedOpenCandleLogo src={logoUrl} {...props} />;
}
