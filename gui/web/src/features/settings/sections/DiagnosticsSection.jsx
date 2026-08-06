import { DiagnosticsContent } from "../../diagnostics/DiagnosticsPage.jsx";

/**
 * Settings -> Diagnostics.
 *
 * The same health report the standalone page carried, now a settings section.
 * Its remediation actions hand off to the sections that own the fix: a provider
 * check opens that provider's row, a model check opens Settings -> Model.
 */
export function DiagnosticsSection({
  role,
  setToast,
  onOpenProviders,
  onOpenModelSetup,
  initialReport,
  dataQuality,
}) {
  return (
    <DiagnosticsContent
      role={role}
      setToast={setToast}
      onOpenProviders={onOpenProviders}
      onOpenModelSetup={onOpenModelSetup}
      initialReport={initialReport}
      dataQuality={dataQuality}
    />
  );
}
