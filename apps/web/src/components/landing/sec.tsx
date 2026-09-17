/** Section wrapper: the 1224 container with left and right hairlines and corner ticks, as every reference section has. */
export function Sec({ id, children, className, style, ticks = true }: { id?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; ticks?: boolean }) {
  return (
    <section id={id} className={`asec ${className ?? ""}`} style={style}>
      <div className="acontainer">
        {ticks ? <><span className="tick tl" aria-hidden /><span className="tick tr" aria-hidden /><span className="tick bl" aria-hidden /><span className="tick br" aria-hidden /></> : null}
        {children}
      </div>
    </section>
  );
}
