"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import SystemStatus from './SystemStatus';
import type { BuildStatus } from '../lib/status';
import type { Post, Species } from '../lib/types';
import {
  filterSpecies,
  formatRange,
  groups,
  regions,
} from '../lib/domain';
import RegionMap from './RegionMap';
import { useHydrated } from '../lib/useHydrated';
import Sprite, { SpriteMotionProvider, SpriteMotionControl } from './Sprite';

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    book: (
      <>
        <path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z" />
        <path d="M12 6v15M7 8h2M15 8h2M7 12h2M15 12h2" />
      </>
    ),
    map: (
      <>
        <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16" />
      </>
    ),
    pen: (
      <>
        <path d="m15 4 5 5M4 20l2-7L17 2l5 5L11 18zM4 20l7-2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C8 2 3 7 5 14s13 9 15-11Z" />
        <path d="m4 21 12-12M10 15v-5M10 15h5" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4 10-10" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c-6 6-6 12 0 18 6-6 6-12 0-18Z" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {paths[name] || paths.leaf}
    </svg>
  );
}
function Modal({
  label,
  onClose,
  children,
  className = '',
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    d?.showModal();
    return () => {
      if (d?.open) d.close();
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus();
        else document.getElementById('main')?.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      className={`modal ${className}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const dialog = event.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || active === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <span className="eyebrow">NATUREDEX / FIELD STATION</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={
            label === 'Delete field note' ? 'Cancel deletion' : 'Close entry'
          }
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ContentBody({ body }: { body: string }) {
  return (
    <div className="article-body">
      {body
        .split(/\n\s*\n/)
        .map((part, i) =>
          part.startsWith('## ') ? (
            <h2 key={i}>{part.replace(/^## /, '')}</h2>
          ) : part.startsWith('# ') ? (
            <h2 key={i}>{part.replace(/^# /, '')}</h2>
          ) : (
            <p key={i}>{part}</p>
          ),
        )}
    </div>
  );
}
function SpeciesDetail({
  entry,
  seen,
  onSeen,
  onClose,
}: {
  entry: Species;
  seen: boolean;
  onSeen: () => void;
  onClose: () => void;
}) {
  return (
    <Modal label={entry.name} onClose={onClose} className="species-modal">
      <div className="detail-hero">
        <div className="detail-sprite">
          <Sprite
            src={entry.sprite}
            animatedSrc={entry.spriteAnimated}
            spriteId={entry.id}
            alt={`Pixel illustration of ${entry.name}`}
            width="200"
            height="200"
          />
          <span className="detail-number">
            NO. {String(entry.dexNumber).padStart(3, '0')}
          </span>
        </div>
        <div>
          <span className={`group-badge group-${entry.group.toLowerCase()}`}>
            {entry.group}
          </span>
          <h2>{entry.name}</h2>
          <p className="latin-name">{entry.scientificName}</p>
          <button
            className={`primary-button ${seen ? 'is-seen' : ''}`}
            onClick={onSeen}
            aria-pressed={seen}
            aria-label={`${seen ? 'Marked as seen' : 'Mark as seen'}: ${entry.name}`}
          >
            <Icon name={seen ? 'check' : 'eye'} size={17} />
            {seen ? 'Marked as seen' : 'Mark as seen'}
          </button>
        </div>
      </div>
      <p className="detail-description">{entry.description}</p>
      <dl className="stat-grid">
        <div>
          <dt>ACTIVE HOURS</dt>
          <dd>{entry.activity}</dd>
        </div>
        <div>
          <dt>DIET</dt>
          <dd>{entry.diet.join(', ')}</dd>
        </div>
        <div>
          <dt>LENGTH</dt>
          <dd>{formatRange(entry.size.lengthCm, 'cm')}</dd>
        </div>
        <div>
          <dt>WEIGHT</dt>
          <dd>{formatRange(entry.size.weightKg, 'kg')}</dd>
        </div>
        <div className="wide-stat">
          <dt>HABITAT</dt>
          <dd>{entry.habitats.join(' · ')}</dd>
        </div>
      </dl>
      {entry.size.note && <p className="fine-print">{entry.size.note}</p>}
      <h3 className="detail-subtitle">Where to explore</h3>
      <div className="detail-regions">
        {entry.regionIds.map((id) => (
          <span key={id}>
            {regions.find((r) => r.id === id)?.shortName || id}
          </span>
        ))}
      </div>
      <p className="fine-print">{entry.regionNote}</p>
      <div className="source-links">
        <span className="eyebrow">FIELD REFERENCES</span>
        {entry.sourceURLs.map((url, i) => (
          <a href={url} target="_blank" rel="noreferrer" key={url}>
            {new URL(url).hostname.replace('www.', '')} · Source {i + 1} ↗
          </a>
        ))}
      </div>
    </Modal>
  );
}
function SpeciesCard({
  entry,
  seen,
  onOpen,
  onSeen,
}: {
  entry: Species;
  seen: boolean;
  onOpen: () => void;
  onSeen: () => void;
}) {
  return (
    <article className={`species-card ${seen ? 'species-seen' : ''}`}>
      <div className="card-topline">
        <span className="dex-number">
          NO. {String(entry.dexNumber).padStart(3, '0')}
        </span>
        <button
          className="seen-toggle"
          aria-label={`${seen ? 'Unmark' : 'Mark'} ${entry.name} as seen`}
          aria-pressed={seen}
          onClick={onSeen}
        >
          {seen ? <Icon name="check" size={13} /> : <span />}
        </button>
      </div>
      <div className="species-open">
        <div className="sprite-stage">
          <Sprite
            src={entry.sprite}
            animatedSrc={entry.spriteAnimated}
            spriteId={entry.id}
            alt=""
            width="106"
            height="106"
            loading="lazy"
          />
          <span className="sprite-shadow" />
        </div>
        <h3>
          <button
            className="species-title"
            onClick={onOpen}
            aria-label={`View ${entry.name}`}
          >
            {entry.name}
          </button>
        </h3>
        <p className="latin-name">{entry.scientificName}</p>
        <div className="card-statline">
          <span>{entry.activity}</span>
          <span>
            {entry.size.lengthCm
              ? formatRange(entry.size.lengthCm, 'cm')
              : entry.habitats[0]}
          </span>
        </div>
        <span className={`group-badge group-${entry.group.toLowerCase()}`}>
          <span className="badge-dot" />
          {entry.group}
        </span>
        <span className="card-arrow" aria-hidden="true">
          ↗
        </span>
      </div>
    </article>
  );
}
function JournalCard({
  post,
  species,
  compact = false,
}: {
  post: Post;
  species: Species[];
  compact?: boolean;
}) {
  const art =
    species.find((s) => post.relatedSpeciesIds?.includes(s.id)) || species[0];
  return (
    <article className={`journal-card ${compact ? 'journal-compact' : ''}`}>
      <a
        className="journal-cover"
        href={`/journal/${post.slug}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className="journal-cover-grid" />
        {art && <Sprite src={art.sprite} animatedSrc={art.spriteAnimated} spriteId={art.id} alt="" width="120" height="120" />}
        <span className="cover-stamp">
          FIELD
          <br />
          NOTES
        </span>
      </a>
      <div className="journal-card-copy">
        <span className="eyebrow">{post.category || 'FIELD NOTES'}</span>
        <h3>
          <a href={`/journal/${post.slug}`}>{post.title}</a>
        </h3>
        <p>{post.excerpt}</p>
        <a className="text-link" href={`/journal/${post.slug}`}>
          Read field note <Icon name="arrow" size={15} />
        </a>
      </div>
    </article>
  );
}
function NaturedexContent({
  species,
  initialPath,
  posts,
  cmsUrl,
  status,
}: {
  species: Species[];
  initialPath: string;
  posts: Post[];
  cmsUrl: string;
  status?: BuildStatus;
}) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('All');
  const [region, setRegion] = useState('all');
  const hydrated = useHydrated();
  const [seenOnlyOverride, setSeenOnly] = useState<boolean | null>(null);
  const [seenOverride, setSeen] = useState<string[] | null>(null);
  const seenOnly = seenOnlyOverride ?? (hydrated &&
    new URLSearchParams(window.location.search).get('collection') === '1');
  const seen = useMemo(() => {
    if (seenOverride !== null) return seenOverride;
    if (!hydrated) return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('naturedex.seen.v1') || '[]');
      if (Array.isArray(saved)) return saved.filter(
        (id: unknown): id is string => typeof id === 'string' && species.some(s => s.id === id),
      );
    } catch { /* A blocked or malformed store starts an empty collection. */ }
    return [];
  }, [hydrated, seenOverride, species]);
  const [selected, setSelected] = useState<Species | null>(null);
  const [sort, setSort] = useState('number');
  const [notice, setNotice] = useState('');
  const isEditor = initialPath === '/editor';
  const isJournal = initialPath.startsWith('/journal');
  const isMap = initialPath === '/map';
  const isAbout = initialPath === '/about';
  const isNotFound = initialPath === '/404';
  const isStatus = initialPath === '/status';
  const isGuide = initialPath === '/' || isMap;
  const nav = [
    { label: 'Field guide', href: '/', icon: 'book' },
    { label: 'Region map', href: '/map', icon: 'map' },
    { label: 'Field journal', href: '/journal', icon: 'pen' },
    { label: 'Writing desk', href: '/editor', icon: 'leaf' },
  ];
  function toggleSeen(id: string) {
    const next = seen.includes(id) ? seen.filter(s => s !== id) : [...seen, id];
    setSeen(next);
    try {
      localStorage.setItem('naturedex.seen.v1', JSON.stringify(next));
    } catch {
      setNotice('Your collection is available for this visit, but browser storage is unavailable.');
    }
  }
  const filtered = filterSpecies(
    species,
    search,
    group,
    region,
    seenOnly,
    seen,
  ).sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : a.dexNumber - b.dexNumber,
  );
  const published = posts.filter((p) => p.status === 'published');
  const article =
    isJournal && initialPath != '/journal'
      ? published.find(
          (p) =>
            p.slug === decodeURIComponent(initialPath.split('/').pop() || ''),
        )
      : null;
  const activeRegion = regions.find((r) => r.id === region);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="Naturedex home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path
                d="M5 15h6V9h6V5h11v11h-5v6h-7v6h-5v-7H5z"
                fill="currentColor"
              />
              <path
                d="M12 19h5v-5h6"
                fill="none"
                stroke="#f4f2e6"
                strokeWidth="3"
              />
            </svg>
          </span>
          <span>
            naturedex<span className="brand-period">.</span>
          </span>
        </a>
        <p className="edition-label">
          VIRGINIA EDITION <span>01</span>
        </p>
        <div className="sidebar-rule" />
        <span className="nav-label">YOUR FIELD STATION</span>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`nav-item ${(item.href === '/' ? initialPath === '/' : initialPath.startsWith(item.href)) ? 'active' : ''}`}
              aria-current={
                (
                  item.href === '/'
                    ? initialPath === '/'
                    : initialPath.startsWith(item.href)
                )
                  ? 'page'
                  : undefined
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.href === '/' && (
                <span className="nav-count">{species.length}</span>
              )}
              {item.href === '/editor' && (
                <span className="nav-local">EDITOR</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-collection">
          <span className="eyebrow">YOUR COLLECTION</span>
          <div className="collection-count">
            <span>{String(seen.length).padStart(2, '0')}</span>
            <small>/ {species.length} discovered</small>
          </div>
          <div className="progress-track">
            <span
              style={{ width: `${(seen.length / species.length) * 100}%` }}
            />
          </div>
          <a href="/?collection=1" className="collection-link">
            View your discoveries <Icon name="arrow" size={14} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <div className="little-grass" aria-hidden="true">
            ♧ ♧ ♧
          </div>
          <p>
            A little curiosity.
            <br />A whole wild world.
          </p>
          <a href="/about">
            <Icon name="info" size={15} />
            About this field guide
          </a>
          <a href="/status/">
            <Icon name="check" size={15} />
            System status
          </a>
          <span className="local-indicator">
            <span />
            EXPLORE. NOTICE. REMEMBER.
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>EXPLORER’S LOG</span>
            <span aria-hidden="true">/</span>
            <strong>
              {isEditor
                ? 'WRITING DESK'
                : isJournal
                  ? 'FIELD JOURNAL'
                  : isMap
                    ? 'REGION MAP'
                    : isAbout
                      ? 'ABOUT'
                      : isStatus
                        ? 'SYSTEM STATUS'
                        : 'FIELD GUIDE'}
            </strong>
          </div>
          <div className="topbar-right">
            <SpriteMotionControl />
            <a className="hosted-auth-link" href="/editor/">CMS login</a>
            <span className="local-badge">
              <span />
              VIRGINIA WILDLIFE
            </span>
            <span className="researcher-avatar" aria-label="Your field station">
              N
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                <span className="tiny-cross" aria-hidden="true">
                  ✦
                </span>{' '}
                {isEditor
                  ? 'A PLACE FOR YOUR OBSERVATIONS'
                  : isJournal
                    ? 'STORIES FROM THE OUTSIDE'
                    : isMap
                      ? 'FOLLOW YOUR CURIOSITY'
                      : isAbout
                        ? 'A FIELD GUIDE, WITH A LITTLE NOSTALGIA'
                        : isStatus
                          ? 'BEHIND THE SCENES'
                          : 'VIRGINIA, ONE DISCOVERY AT A TIME'}
              </p>
              <h1>
                {isNotFound ? 'This trail doesn’t lead anywhere.' : isEditor
                  ? 'Your writing desk.'
                  : isJournal
                    ? article
                      ? article.title
                      : 'Notes from the field.'
                    : isMap
                      ? 'Adventure has a map.'
                      : isAbout
                        ? 'Made for the curious.'
                        : isStatus
                          ? 'System status.'
                          : 'Meet your wild neighbors.'}
              </h1>
              <p className="page-description">
                {isEditor
                  ? 'Create a field note, refine an entry, or share a discovery.'
                  : isJournal
                    ? 'Small observations. Good questions. Stories worth stepping outside for.'
                    : isMap
                      ? 'From mountain trails to tidal shores. Pick a region and see who lives there.'
                      : isAbout
                        ? 'An original, pocket-sized guide to the animals that make Virginia home.'
                        : isStatus
                          ? 'What is live on this site, and the checks it passed on the way.'
                          : 'From the Blue Ridge to the bay. Get to know the wildlife just beyond your doorstep.'}
              </p>
            </div>
            {!isEditor && !article && (
              <div className="heading-stamp">
                <Icon name={isJournal ? 'pen' : 'globe'} size={22} />
                <span>
                  EST. 2026
                  <br />
                  <strong>STAY CURIOUS</strong>
                </span>
              </div>
            )}
          </div>
          {notice && (
            <p className="status-message" role="status">
              {notice}
            </p>
          )}
          {isGuide && (
            <>
              <section
                className="discovery-strip"
                aria-label="Field guide overview"
              >
                <div>
                  <span className="strip-icon">
                    <Icon name="book" />
                  </span>
                  <p>
                    <strong>{String(species.length).padStart(2, '0')}</strong>
                    <span>species to discover</span>
                  </p>
                </div>
                <div>
                  <span className="strip-icon">
                    <Icon name="leaf" />
                  </span>
                  <p>
                    <strong>06</strong>
                    <span>animal groups</span>
                  </p>
                </div>
                <div>
                  <span className="strip-icon">
                    <Icon name="map" />
                  </span>
                  <p>
                    <strong>04</strong>
                    <span>regions to explore</span>
                  </p>
                </div>
                <span className="strip-message">
                  THE BEST ADVENTURES
                  <br />
                  <strong>START WITH A CLOSER LOOK.</strong>
                  <Sprite
                    src="/ui/northern-cardinal.svg"
                    animatedSrc="/ui/northern-cardinal-animated.svg"
                    spriteId="northern-cardinal"
                    alt=""
                    width="60"
                    height="60"
                  />
                </span>
              </section>
              <div className={`guide-layout ${isMap ? 'map-first' : ''}`}>
                <section
                  className="species-section"
                  aria-label="Virginia animal entries"
                >
                  <div className="search-box">
                    <Icon name="search" size={18} />
                    <input
                      type="search"
                      aria-label="Search the field guide"
                      placeholder="Search a name, species, or habitat…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span className="search-hint" aria-hidden="true">
                      ⌕
                    </span>
                  </div>
                  <div className="filter-row">
                    <label className="group-select-label">
                      <span className="sr-only">Animal group</span>
                      <select
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                      >
                        <option value="All">All animals</option>
                        {groups.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className={`filter-seen ${seenOnly ? 'active' : ''}`}
                      onClick={() => setSeenOnly(!seenOnly)}
                      aria-pressed={seenOnly}
                    >
                      <Icon name="eye" size={15} />
                      Discovered
                    </button>
                    <label className="sort-label">
                      <span className="sr-only">Sort entries</span>
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="number">Dex number</option>
                        <option value="name">A–Z</option>
                      </select>
                    </label>
                  </div>
                  {activeRegion && (
                    <div className="region-filter">
                      <span>
                        <Icon name="map" size={14} />
                        {activeRegion.shortName}
                      </span>
                      <button
                        onClick={() => setRegion('all')}
                        aria-label="Clear region filter"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                  <div className="results-heading">
                    <h2>
                      {seenOnly
                        ? 'YOUR DISCOVERIES'
                        : group === 'All'
                          ? 'THE VIRGINIA DEX'
                          : group.toUpperCase()}
                    </h2>
                    <span role="status" aria-live="polite">
                      {filtered.length}{' '}
                      {filtered.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                  <div className="species-grid">
                    {filtered.map((entry) => (
                      <SpeciesCard
                        key={entry.id}
                        entry={entry}
                        seen={seen.includes(entry.id)}
                        onOpen={() => setSelected(entry)}
                        onSeen={() => toggleSeen(entry.id)}
                      />
                    ))}
                  </div>
                  {filtered.length === 0 && (
                    <div className="empty-state">
                      <Icon name="search" size={32} />
                      <h3>No creatures in this patch.</h3>
                      <p>Try a different name, group, or region.</p>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setSearch('');
                          setGroup('All');
                          setRegion('all');
                          setSeenOnly(false);
                        }}
                      >
                        Reset filters
                      </button>
                    </div>
                  )}
                </section>
                <div className="guide-aside">
                  <RegionMap
                    selected={region}
                    onSelect={setRegion}
                    species={species}
                    large={isMap}
                  />
                  {activeRegion && (
                    <div className="region-note panel">
                      <span className="eyebrow">A HABITAT WORTH EXPLORING</span>
                      <h3>{activeRegion.name}</h3>
                      <p>{activeRegion.description}</p>
                    </div>
                  )}
                  <section className="field-tip">
                    <div className="field-tip-icon">
                      <Icon name="leaf" size={23} />
                    </div>
                    <div>
                      <span className="eyebrow">A NOTE FROM THE TRAIL</span>
                      <h3>Look a little longer.</h3>
                      <p>
                        Slow down, listen closely, and leave every habitat just
                        as you found it.
                      </p>
                    </div>
                    <span className="tip-sparkle" aria-hidden="true">
                      ✦
                    </span>
                  </section>
                  <section className="aside-journal">
                    <div className="results-heading">
                      <h2>FROM THE FIELD JOURNAL</h2>
                      <a href="/journal" aria-label="View all field notes">
                        View all ↗
                      </a>
                    </div>
                    {published.slice(0, 2).map((p) => (
                      <JournalCard
                        key={p.id}
                        post={p}
                        species={species}
                        compact
                      />
                    ))}
                    
                  </section>
                  <div className="original-note">
                    <span aria-hidden="true">✧</span>
                    <p>
                      Real wildlife. Original pixel art.
                      <br />A field guide with a little nostalgia.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
          {isJournal && (
            <>
              {article ? (
                <article className="full-article">
                  <a href="/journal" className="text-link">
                    ← All field notes
                  </a>
                  <div className="article-meta">
                    <span className="group-badge">{article.category}</span>
                    <span>{article.author || 'Naturedex Field Notes'}</span>
                  </div>
                  <p className="article-lede">{article.excerpt}</p>
                  <ContentBody body={article.body} />
                  {article.relatedSpeciesIds?.length > 0 && (
                    <section className="article-related">
                      <h2>Meet the neighbors in this story</h2>
                      <div className="species-grid">
                        {species
                          .filter((s) =>
                            article.relatedSpeciesIds.includes(s.id),
                          )
                          .map((s) => (
                            <SpeciesCard
                              key={s.id}
                              entry={s}
                              seen={seen.includes(s.id)}
                              onOpen={() => setSelected(s)}
                              onSeen={() => toggleSeen(s.id)}
                            />
                          ))}
                      </div>
                    </section>
                  )}
                </article>
              ) : (
                <>
                  <div className="journal-intro">
                    <p>A journal for the things you almost walked past.</p>
                    <a href="/editor" className="secondary-button">
                      <Icon name="pen" size={16} />
                      Write a field note
                    </a>
                  </div>
                  <div className="journal-grid">
                    {published.map((p) => (
                      <JournalCard key={p.id} post={p} species={species} />
                    ))}
                  </div>
                  {published.length === 0 && (
                    <div className="empty-state">
                      <h2>The first page is yours.</h2>
                      <p>
                        Publish a field note from the writing desk to start your
                        journal.
                      </p>
                      <a href="/editor" className="primary-button">
                        Open writing desk
                      </a>
                    </div>
                  )}
                  {initialPath != '/journal' && !article && (
                    <p className="error-message" role="alert">
                      This field note is unavailable or has not been published.
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {isEditor && (
            <>
              <section className="cms-desk panel" aria-labelledby="cms-desk-title">
                <span className="eyebrow">YOUR AUTHORING WORKSPACE</span>
                <h2 id="cms-desk-title">A home for your field notes.</h2>
                <p>Sign in to Contentstack to create, edit, and organize field notes and wildlife entries. Your Contentstack account controls who can make changes.</p>
                <a className="primary-button" href={cmsUrl} rel="noreferrer">Open Contentstack <Icon name="arrow" size={16} /></a>
                <div className="cms-workflow">
                  <div><span className="eyebrow">01 / WRITE</span><h3>Capture a discovery</h3><p>Create a blog post, add section headings, and link the animals in your story.</p></div>
                  <div><span className="eyebrow">02 / REVIEW</span><h3>Make it yours</h3><p>Keep work in draft while you refine the words and check your sources.</p></div>
                  <div><span className="eyebrow">03 / SHARE</span><h3>Send it into the wild</h3><p>Publish to the website environment. A site rebuild brings the update into the public journal.</p></div>
                </div>
                <p className="fine-print">A Contentstack account with access to the Naturedex stack is required. Publishing, unpublishing, or deleting CMS content takes effect on this website after the next content sync, build, and release.</p>
              </section>
            </>
          )}
          {isAbout && (
            <div className="about-content panel">
              <Sprite
                src="/ui/white-tailed-deer.svg"
                animatedSrc="/ui/white-tailed-deer-animated.svg"
                spriteId="white-tailed-deer"
                alt="Original pixel illustration of a white-tailed deer"
                width="150"
                height="150"
              />
              <h2>A familiar feeling. A real wild world.</h2>
              <p>
                Naturedex is a Virginia field guide inspired by the curiosity and
                pixel-filled adventures of handheld games. Its creatures are
                real Virginia wildlife, and its illustrations are original.
              </p>
              <h2>How to read this guide</h2>
              <p>
                The entries are a curated collection across six
                animal groups, not a complete checklist of Virginia wildlife.
                Size measurements describe general adult ranges where a source
                supports them. Reference links are provided inside each entry.
              </p>
              <p>
                The map’s regions are broad habitat guides. Pins mark regions,
                not animal observations or precise distribution boundaries. They
                are intended to help you explore the collection.
              </p>
              <h2>Your own field journal</h2>
              <p>
                Field notes and wildlife entries are authored in Contentstack.
                Published content is included when the site is built. Your discovery
                collection is saved only in this browser; signing in to the CMS
                does not synchronize your collection across devices.
              </p>
              <h2>Accessible exploration</h2>
              <p>
                Every map region has a labeled button. You can explore the
                complete guide as a list, use the interface with a keyboard, and
                reduce motion through your device preferences. Automated testing
                supports this work; manual accessibility evaluation remains an
                ongoing task.
              </p>
              <a
                className="text-link"
                href="https://dwr.virginia.gov/wildlife/wildlife-information/"
                target="_blank"
                rel="noreferrer"
              >
                Explore Virginia DWR’s wildlife resources ↗
              </a>
            </div>
          )}
          {isStatus && status && <SystemStatus status={status} />}
          {!isGuide && !isJournal && !isEditor && !isAbout && !isStatus && (
            <div className="empty-state">
              <p>Try the field guide to find your way back.</p>
              <a className="primary-button" href="/">
                Return to the field guide
              </a>
            </div>
          )}
          <footer className="page-footer">
            <span>
              NATUREDEX <span className="footer-star">✦</span> VIRGINIA EDITION
            </span>
            <a href="/status/">System status</a>
            <span>Take only memories. Leave only footprints.</span>
          </footer>
        </main>
      </div>
      {selected && (
        <SpeciesDetail
          entry={selected}
          seen={seen.includes(selected.id)}
          onSeen={() => toggleSeen(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default function Naturedex(props: {
  species: Species[];
  initialPath: string;
  posts: Post[];
  cmsUrl: string;
  status?: BuildStatus;
}) {
  return (
    <SpriteMotionProvider>
      <NaturedexContent {...props} />
    </SpriteMotionProvider>
  );
}
