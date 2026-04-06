export default function Header() {
  return (
    <header className="w-full border-b border-border-subtle px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="font-heading text-lg font-semibold tracking-tight">
          PANO360ALIGN
        </h1>
        <p className="font-mono text-xs text-text-muted">
          360° panorama horizon correction
        </p>
      </div>
      <a
        href="https://pano360align.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-text-muted hover:text-accent transition-colors"
      >
        pano360align.com
      </a>
    </header>
  );
}
