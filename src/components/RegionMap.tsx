import { useEffect, useState } from 'react';
import { regions } from '../lib/domain';
import type { Species } from '../lib/types';

function project(point: number[]) {
  return [
    ((point[0] + 83.8) / 8.7) * 620 + 30,
    ((39.6 - point[1]) / 3.2) * 300 + 40,
  ];
}
function ringPath(ring: number[][]) {
  return (
    ring
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${project(p)
            .map((n) => n.toFixed(1))
            .join(',')}`,
      )
      .join(' ') + 'Z'
  );
}
export default function RegionMap({
  selected,
  onSelect,
  species,
  large = false,
}: {
  selected: string;
  onSelect: (id: string) => void;
  species: Species[];
  large?: boolean;
}) {
  const [outline, setOutline] = useState(
    'M38,324 L95,278 L150,278 L198,227 L242,230 L292,164 L338,178 L366,119 L409,133 L426,88 L466,111 L476,158 L506,165 L509,203 L549,219 L568,259 L598,278 L593,321 L38,324Z',
  );
  useEffect(() => {
    fetch('/map/virginia.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        const data = raw as { geometry?: {type:string;coordinates:unknown}; features?: {geometry:{type:string;coordinates:unknown}}[] } | null;
        const geometry = data?.geometry || data?.features?.[0]?.geometry;
        if (!geometry) return;
        const polygons = (
          geometry.type === 'MultiPolygon'
            ? geometry.coordinates
            : [geometry.coordinates]) as number[][][][];
        setOutline(
          polygons
            .map((p: number[][][]) => p.map(ringPath).join(' '))
            .join(' '),
        );
      })
      .catch(() => {});
  }, []);
  return (
    <section
      className={`region-panel ${large ? 'region-panel-large' : ''}`}
      aria-labelledby="region-map-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR NEXT DISCOVERY</span>
          <h2 id="region-map-title">A little closer to the wild.</h2>
        </div>
        <span className="map-mini-icon" aria-hidden="true">
          ↗
        </span>
      </div>
      <div className="map-canvas">
        <span className="map-coordinate map-coordinate-top">39° N / 83° W</span>
        <svg
          viewBox="0 0 680 400"
          role="img"
          aria-label="Virginia outline with four selectable regional habitat areas. Use the region buttons to explore associated animals."
        >
          <defs>
            <pattern
              id="map-grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M20 0H0V20"
                fill="none"
                stroke="#849d79"
                strokeOpacity=".15"
                strokeWidth="1"
              />
            </pattern>
            <pattern
              id="forest"
              width="36"
              height="36"
              patternUnits="userSpaceOnUse"
            >
              <path d="M8 6h6v5h4v5H4v-5h4z" fill="#547d55" opacity=".2" />
              <path d="M10 16h2v5h-2z" fill="#547d55" opacity=".3" />
            </pattern>
            <clipPath id="virginia-clip">
              <path d={outline} />
            </clipPath>
          </defs>
          <rect width="680" height="400" fill="url(#map-grid)" />
          <text x="558" y="76" className="map-water-label">
            CHESAPEAKE
          </text>
          <text x="579" y="92" className="map-water-label">
            BAY
          </text>
          <path
            d={outline}
            transform="translate(0 7)"
            fill="#a0b393"
            opacity=".45"
          />
          <path
            d={outline}
            fill="#b7ce92"
            stroke="#637e50"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <g clipPath="url(#virginia-clip)">
            <path d="M0 0h300L190 400H0Z" fill="#8eaf79" />
            <path d="M300 0h80L270 400h-80Z" fill="#c5ce91" />
            <path d="M470 0h210v400H390Z" fill="#d2d3a4" />
            <path d="M0 0h300L190 400H0Z" fill="url(#forest)" />
            <path d="M300 0h80L270 400h-80Z" fill="url(#forest)" opacity=".6" />
            <path
              d="M338 186l32 35 42-8 30 31 40 8 36 38 64 11"
              stroke="#79a9a7"
              strokeWidth="4"
              fill="none"
              strokeLinejoin="round"
            />
            <path
              d="M409 132l24 48 45 11 40 35 46 1"
              stroke="#79a9a7"
              strokeWidth="3"
              fill="none"
            />
            {Array.from({ length: 7 }, (_, i) => (
              <path
                key={i}
                d={`M${176 + i * 13} ${268 - i * 14}l10-16 10 16z`}
                fill="#567f5c"
                opacity=".5"
              />
            ))}
          </g>
          <path
            d={outline}
            fill="none"
            stroke="#637e50"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <text x="178" y="348" className="map-state-label">
            NORTH CAROLINA
          </text>
          <text x="200" y="105" className="map-state-label">
            WEST VIRGINIA
          </text>
          <g transform="translate(631 140)" fill="#50664f">
            <path d="M0-15l-6 19 6-4 6 4z" />
            <text x="-4" y="-23" fontSize="11">
              N
            </text>
          </g>
        </svg>
        {regions.map((r) => (
          <button
            key={r.id}
            className={`map-marker ${selected === r.id ? 'is-active' : ''}`}
            style={{
              left: `${(r.x / 680) * 100}%`,
              top: `${(r.y / 400) * 100}%`,
            }}
            onClick={() => onSelect(selected === r.id ? 'all' : r.id)}
            aria-label={`${r.shortName}: ${r.name}`}
            aria-pressed={selected === r.id}
          >
            <span className="marker-square" />
            <span className="marker-label">{r.shortName}</span>
          </button>
        ))}
        <span className="map-coordinate map-coordinate-bottom">
          VIRGINIA, UNITED STATES
        </span>
      </div>
      <div className="map-legend">
        {regions.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(selected === r.id ? 'all' : r.id)}
            aria-pressed={selected === r.id}
            className={selected === r.id ? 'active' : ''}
          >
            <span style={{ background: r.color }} />
            {r.shortName}
            <small>
              {species.filter((s) => s.regionIds.includes(r.id)).length}
            </small>
          </button>
        ))}
      </div>
      <p className="map-caption">
        Select a region to explore its wildlife. Regional habitat associations
        are illustrative, not recorded sightings or complete species ranges.
      </p>
    </section>
  );
}
