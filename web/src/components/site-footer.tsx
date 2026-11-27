// The web app's own version, inlined at build time from version.txt (see next.config.ts).
// One template-literal text node, so the HTML contains "v0.1.0" verbatim for the smoke test.
export function SiteFooter({
  version = process.env.NEXT_PUBLIC_APP_VERSION,
}: {
  version?: string;
}) {
  return (
    <footer className="p-4 text-center text-sm text-muted-foreground">
      {version && <span className="font-mono">{`v${version}`}</span>}
    </footer>
  );
}
