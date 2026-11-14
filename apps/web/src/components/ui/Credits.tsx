export function Credits() {
  return (
    <footer className="pointer-events-auto absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-x-3 gap-y-1 bg-gradient-to-t from-black/80 to-transparent px-4 pb-2 pt-6 text-[11px] text-neutral-400">
      <span>Data:</span>
      <a className="underline hover:text-neutral-200" href="https://svs.gsfc.nasa.gov/14959" target="_blank" rel="noreferrer">
        NASA&apos;s Scientific Visualization Studio
      </a>
      <span aria-hidden>·</span>
      <a className="underline hover:text-neutral-200" href="https://www.lroc.asu.edu/" target="_blank" rel="noreferrer">
        LRO LROC (NASA/GSFC/ASU)
      </a>
      <span aria-hidden>·</span>
      <a className="underline hover:text-neutral-200" href="https://lola.gsfc.nasa.gov/" target="_blank" rel="noreferrer">
        LRO LOLA (NASA/GSFC)
      </a>
      <span aria-hidden>·</span>
      <a className="underline hover:text-neutral-200" href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noreferrer">
        CGI Moon Kit
      </a>
      <span className="ml-auto">NASA Space Apps Challenge 2026 · Recife</span>
    </footer>
  );
}
