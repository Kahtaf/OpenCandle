const FORBIDDEN_DEPENDENCY_MARKERS = [
  "better-sqlite3",
  "child_process",
  "twitter-cli",
  "rdt-cli",
];
const APPROVED_PI_PROVIDERS = new Set(["anthropic", "google", "openai"]);
const PI_PROVIDER_PATH =
  /@earendil-works\/pi-ai\/dist\/providers\/(?:data\/)?([^/.]+?)(?:\.models)?\.(?:js|json)$/;

export function auditRuntimeComposition({
  output,
  metafile,
  sensitiveValues,
  maxBytes,
}) {
  const bytes = Buffer.byteLength(output);
  if (bytes > maxBytes) {
    throw new Error(`Runtime payload exceeds ${maxBytes} bytes: ${bytes}`);
  }

  const compositionText = JSON.stringify(metafile).toLowerCase();
  const auditText = `${output}\n${compositionText}`.toLowerCase();
  const dependencyReferences = Object.entries(metafile.inputs).flatMap(([input, metadata]) => [
    input,
    ...(metadata.imports ?? []).map((dependency) => dependency.path),
  ]);
  const forbidden = FORBIDDEN_DEPENDENCY_MARKERS.filter((marker) =>
    dependencyReferences.some((reference) => reference.toLowerCase().includes(marker)),
  );
  if (Object.keys(metafile.inputs).some((path) => path.endsWith(".node"))) {
    forbidden.push("native .node addon");
  }
  if (forbidden.length > 0) {
    const matchingInputs = Object.keys(metafile.inputs).filter((path) =>
      FORBIDDEN_DEPENDENCY_MARKERS.some((marker) => path.toLowerCase().includes(marker)),
    );
    const matchingImports = Object.entries(metafile.inputs).flatMap(([input, metadata]) =>
      (metadata.imports ?? [])
        .filter((dependency) =>
          FORBIDDEN_DEPENDENCY_MARKERS.some((marker) => dependency.path.toLowerCase().includes(marker)),
        )
        .map((dependency) => `${input}->${dependency.path}`),
    );
    throw new Error(
      `Forbidden runtime dependency found: ${forbidden.join(", ")} (${[...matchingInputs, ...matchingImports].join(", ")})`,
    );
  }

  for (const value of sensitiveValues) {
    if (value?.trim() && auditText.includes(value.toLowerCase())) {
      throw new Error("Runtime bundle contains credential material");
    }
  }

  const piProviders = [
    ...new Set(
      Object.keys(metafile.inputs)
        .map((path) => path.match(PI_PROVIDER_PATH)?.[1])
        .filter((provider) => provider !== undefined),
    ),
  ].sort();
  const unapproved = piProviders.filter((provider) => !APPROVED_PI_PROVIDERS.has(provider));
  if (unapproved.length > 0) {
    throw new Error(`Unapproved Pi provider found: ${unapproved.join(", ")}`);
  }

  return { bytes, piProviders };
}
