import { useMemo, useState } from 'react';
import type { Family } from '../api/types';
import { buildTree, pathToRoot, ROLE_LABELS } from '../lib/family';
import { formatCount } from '../lib/format';
import { formatDate } from '../lib/time';

/** Children shown per node before a "show more" button. */
const PAGE = 25;
/** Indentation stops growing past this depth (long aftershock chains). */
const MAX_INDENT = 10;

interface FamilyTreeProps {
  family: Family;
  pinnedRid: number;
  onSelect: (index: number) => void;
}

/**
 * Collapsible parent/child tree of a family. The chain from the root to the
 * pinned event starts expanded; clicking an event pins it.
 */
export function FamilyTree({ family, pinnedRid, onSelect }: FamilyTreeProps) {
  const m = family.members;
  const tree = useMemo(() => buildTree(m), [m]);
  const path = useMemo(() => pathToRoot(tree, m, pinnedRid), [tree, m, pinnedRid]);
  // User toggles, keyed by rid so they survive re-pinning within the same family.
  const [toggled, setToggled] = useState<Map<number, boolean>>(() => new Map());
  const [shown, setShown] = useState<Map<number, number>>(() => new Map());
  const onPath = useMemo(() => new Set(path.map((i) => m.rid[i])), [path, m]);

  const isOpen = (i: number) =>
    toggled.get(m.rid[i]) ?? (onPath.has(m.rid[i]) || tree.roots.includes(i));
  const toggle = (i: number) => setToggled((prev) => new Map(prev).set(m.rid[i], !isOpen(i)));

  function renderNode(i: number, depth: number) {
    const kids = tree.children[i];
    const open = kids.length > 0 && isOpen(i);
    const rid = m.rid[i];
    const pinned = rid === pinnedRid;
    const limit = shown.get(rid) ?? PAGE;
    return (
      <li key={rid} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={pinned}>
        <div
          className={`flex items-center gap-1 rounded-md py-0.5 pr-1 ${pinned ? 'bg-raised ring-1 ring-line-strong' : 'hover:bg-raised/60'}`}
          style={{ paddingLeft: `${Math.min(depth, MAX_INDENT) * 0.75}rem` }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(i)}
              className="w-4 shrink-0 text-center text-ink-3 hover:text-ink"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${kids.length} direct children`}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-4 shrink-0 text-center text-ink-3" aria-hidden="true">
              ·
            </span>
          )}
          <button
            type="button"
            onClick={() => onSelect(i)}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
            title={`${ROLE_LABELS[m.role[i]]}, generation ${m.generation[i]}`}
          >
            <span className={`tnum shrink-0 font-semibold ${m.role[i] === 'mainshock' ? 'text-ink' : 'text-ink-2'}`}>
              M {m.magnitude[i].toFixed(1)}
            </span>
            <span className="tnum truncate text-ink-2">{formatDate(m.time[i])}</span>
            {m.role[i] === 'mainshock' && <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink">main</span>}
            {depth > MAX_INDENT && <span className="shrink-0 text-[10px] text-ink-3">gen {m.generation[i]}</span>}
            {tree.descendants[i] > 0 && (
              <span className="tnum ml-auto shrink-0 text-[10px] text-ink-3">+{formatCount(tree.descendants[i])}</span>
            )}
          </button>
        </div>
        {open && (
          <ul role="group">
            {kids.slice(0, limit).map((c) => renderNode(c, depth + 1))}
            {kids.length > limit && (
              <li style={{ paddingLeft: `${Math.min(depth + 1, MAX_INDENT) * 0.75 + 1.25}rem` }}>
                <button
                  type="button"
                  className="link py-0.5 text-[11px]"
                  onClick={() => setShown((prev) => new Map(prev).set(rid, limit + PAGE))}
                >
                  Show {Math.min(PAGE, kids.length - limit)} more of {formatCount(kids.length - limit)}
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul role="tree" aria-label="Family tree" className="text-xs">
      {tree.roots.map((r) => renderNode(r, 0))}
    </ul>
  );
}
