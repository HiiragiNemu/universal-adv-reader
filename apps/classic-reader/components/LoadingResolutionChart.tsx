import { useId } from 'react';

// A vector interpretation of the supplied EIA 1956 card, not a calibration asset.
// The original large grey corner fields are intentionally left as theme paper.
function CornerTarget({ x, y, index }: { x: number; y: number; index: number }) {
  return <g data-loading-target={index} transform={`translate(${x} ${y})`}>
    <circle r="76" fill="none" stroke="currentColor" strokeWidth="2.5" />
    {[30, 45, 59].map(r => <circle key={r} r={r} fill="none" stroke="currentColor" strokeWidth=".7" />)}
    {[0, 90, 180, 270].map(angle => <g key={angle} transform={`rotate(${angle})`}>
      {[-2, -1, 0, 1, 2].map(n => <path key={n}
        d={`M ${n * 5 - 1.5} -75 L ${n * 1.1 - .35} -12 L ${n * 1.1 + .35} -12 L ${n * 5 + 1.5} -75 Z`}
        fill="currentColor" />)}
    </g>)}
    <circle r="12" fill="var(--loading-paper)" stroke="currentColor" strokeWidth="3" />
    <circle r="4" fill="currentColor" />
    <text x="-49" y="-49" fontSize="10" transform="rotate(-45 -49 -49)">200</text>
    <text x="30" y="42" fontSize="10">150</text>
  </g>;
}

export default function LoadingResolutionChart() {
  const id = useId();
  const stripes = `loading-lines-${id}`;
  return <svg className="magi-loading-chart" viewBox="0 0 1000 760" aria-hidden="true" focusable="false">
    <defs>
      <pattern id={stripes} width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M 2 0 V 8" stroke="currentColor" strokeWidth="3" />
      </pattern>
    </defs>
    <g fill="currentColor" fontFamily="ui-monospace, Consolas, monospace">
      <rect className="magi-loading-chart-border" x="21" y="21" width="958" height="718" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="500" cy="380" r="286" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="500" cy="380" r="278" fill="none" stroke="currentColor" strokeWidth=".8" />
      <CornerTarget x={126} y={126} index={0} /><CornerTarget x={874} y={126} index={1} />
      <CornerTarget x={126} y={634} index={2} /><CornerTarget x={874} y={634} index={3} />
      {[0, 1].map(side => <g key={side} transform={side ? 'translate(1000 760) rotate(180)' : undefined}>
        <path d="M 489 40 H 511 M 500 29 V 51" stroke="currentColor" strokeWidth="3" />
        <path d="M 20 224 L 40 215 V 233 Z M 216 21 L 207 41 H 225 Z" />
        <rect x="24" y="323" width="126" height="114" fill={`url(#${stripes})`} />
        <text x="64" y="457" fontSize="14">200</text>
        <g transform="translate(269 23) rotate(90)">
          <rect width="102" height="29" fill={`url(#${stripes})`} />
        </g>
        <text x="238" y="144" fontSize="14">200</text>
        <path d="M 310 185 L 397 273 M 690 185 L 603 273" fill="none" stroke="currentColor" strokeWidth="2" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <rect key={i} x={330 + i * 34} y="142"
          width="34" height="35" opacity={(i + 1) / 11} />)}
        <path d="M 415 112 H 585 M 362 127 H 638" fill="none" stroke="currentColor" strokeWidth="9" />
        {Array.from({ length: 11 }, (_, i) => <path key={i}
          d={`M ${454 + i * 8} 190 L ${486 + i * 2.5} 270 L ${487 + i * 2.5} 270 L ${458 + i * 8} 190 Z`} />)}
        <text x="443" y="184" fontSize="10">200</text><text x="529" y="184" fontSize="10">400</text>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <rect key={i} x="239" y={239 + i * 28}
          width="31" height="28" opacity={(i + 1) / 11} />)}
        {Array.from({ length: 10 }, (_, i) => <path key={i}
          d={`M 275 ${337 + i * 8} L 314 ${368 + i * 2.2} L 314 ${369 + i * 2.2} L 275 ${341 + i * 8} Z`} />)}
        <text x="279" y="326" fontSize="10">400</text><text x="279" y="435" fontSize="10">800</text>
      </g>)}
      <circle cx="500" cy="380" r="242" fill="var(--loading-paper)" stroke="currentColor" strokeWidth="3" />
      <circle cx="500" cy="380" r="234" fill="none" stroke="currentColor" strokeWidth=".8" />
      <path d="M 256 380 H 265 M 735 380 H 744 M 500 136 V 145 M 500 615 V 624"
        fill="none" stroke="currentColor" strokeWidth="3" />
      {/* Keep the complete lower scale above the enlarged blank logo field. */}
      <g className="magi-loading-status-scale">
        <rect x="330" y="583" width="340" height="35" fill="var(--loading-paper)" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={330 + i * 34} y="583"
          width="34" height="35" opacity={(10 - i) / 11} />)}
      </g>
      <text x="500" y="697" textAnchor="middle" fontSize="12" letterSpacing="2">EIA 2017 / MAGIUS LINK</text>
      <text x="500" y="73" textAnchor="middle" fontSize="11" letterSpacing="3">STORY ARCHIVE</text>
    </g>
  </svg>;
}
