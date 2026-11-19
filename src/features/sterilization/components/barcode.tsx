import { code128Bars } from "../code128";

export function Code128Barcode({ value }: { value: string }) {
  const { bars, width } = code128Bars(value);
  return <svg role="img" aria-label={value} viewBox={`0 0 ${width} 58`} className="h-16 w-full max-w-72" preserveAspectRatio="none">
    <rect width={width} height="58" fill="white" />
    {bars.map((bar, index) => <rect key={index} x={bar.x} y="2" width={bar.width} height="43" fill="black" />)}
    <text x={width / 2} y="56" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="black">{value}</text>
  </svg>;
}
