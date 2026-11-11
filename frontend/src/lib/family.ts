/**
 * Earthquake families on the client: role codes, the parent/child tree of a
 * family payload, and the line segments drawn on the map.
 */
import type { Family, FamilyMembers, FamilyRole } from '../api/types';
import { msToDecimalYear } from './time';

/** Role codes in the binary events payload (mirrors `quakes.families.ROLES`). */
export const ROLE_CODES: Record<FamilyRole, number> = {
  unclassified: 0,
  single: 1,
  mainshock: 2,
  foreshock: 3,
  aftershock: 4,
};

export function isDependentRole(code: number): boolean {
  return code === ROLE_CODES.foreshock || code === ROLE_CODES.aftershock;
}

export interface FamilyTree {
  /** Member indices without a parent in the payload (normally just the family's root). */
  roots: number[];
  /** Children of each member, in time order. */
  children: number[][];
  /** Number of descendants below each member. */
  descendants: number[];
  indexOf: Map<number, number>;
}

/** Build the tree from parent pointers. Members arrive in time order, so parents come first. */
export function buildTree(members: FamilyMembers): FamilyTree {
  const n = members.rid.length;
  const indexOf = new Map(members.rid.map((rid, i) => [rid, i]));
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    const parent = members.parent_rid[i];
    const p = parent == null ? undefined : indexOf.get(parent);
    if (p === undefined) roots.push(i);
    else children[p].push(i);
  }
  const descendants = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    for (const c of children[i]) descendants[i] += descendants[c] + 1;
  }
  return { roots, children, descendants, indexOf };
}

/** Member indices from the root down to `rid` (empty if `rid` is not a member). */
export function pathToRoot(tree: FamilyTree, members: FamilyMembers, rid: number): number[] {
  const path: number[] = [];
  let i = tree.indexOf.get(rid);
  const seen = new Set<number>();
  while (i !== undefined && !seen.has(i)) {
    seen.add(i);
    path.push(i);
    const parent = members.parent_rid[i];
    i = parent == null ? undefined : tree.indexOf.get(parent);
  }
  return path.reverse();
}

export interface FamilySegment {
  source: [number, number];
  target: [number, number];
  /** Decimal year of the child, for the time-window filter. */
  year: number;
  /** On the chain from the family's root to the pinned event. */
  onPath: boolean;
}

/**
 * One segment per parent link. The child's longitude is shifted by 360° when
 * that is shorter, so links across the antimeridian don't span the whole map.
 */
export function familySegments(family: Family, pinnedRid: number): FamilySegment[] {
  const m = family.members;
  const tree = buildTree(m);
  const path = new Set(pathToRoot(tree, m, pinnedRid));
  const segments: FamilySegment[] = [];
  for (let i = 0; i < m.rid.length; i++) {
    const parent = m.parent_rid[i];
    const p = parent == null ? undefined : tree.indexOf.get(parent);
    if (p === undefined) continue;
    let lon = m.longitude[i];
    const delta = lon - m.longitude[p];
    if (delta > 180) lon -= 360;
    else if (delta < -180) lon += 360;
    segments.push({
      source: [m.longitude[p], m.latitude[p]],
      target: [lon, m.latitude[i]],
      year: msToDecimalYear(m.time[i]),
      onPath: path.has(i) && path.has(p),
    });
  }
  return segments;
}

export const ROLE_LABELS: Record<FamilyRole, string> = {
  unclassified: 'Not classified',
  single: 'Independent event',
  mainshock: 'Mainshock',
  foreshock: 'Foreshock',
  aftershock: 'Aftershock',
};

/** One-line description of where the pinned event sits in its family. */
export function describeRole(family: Family): string {
  const main = family.mainshock;
  const of = main ? `the M ${main.magnitude.toFixed(1)}${main.place ? ` ${main.place}` : ''}` : '';
  switch (family.role) {
    case 'unclassified':
      return 'Historical records are not grouped into families.';
    case 'single':
      return 'No foreshocks or aftershocks in the catalog: an independent event.';
    case 'mainshock':
      return `Mainshock of a family of ${family.size.toLocaleString('en-US')}: ${plural(family.foreshocks, 'foreshock')}, ${plural(family.aftershocks, 'aftershock')}.`;
    case 'foreshock':
      return `Foreshock of ${of} (family of ${family.size.toLocaleString('en-US')}).`;
    case 'aftershock':
      return `Aftershock of ${of} (family of ${family.size.toLocaleString('en-US')}).`;
  }
}

/** Why the event has (or lacks) a parent, in plain words; null for unclassified events. */
export function linkExplanation(family: Family): string | null {
  const nn = family.neighbour;
  if (!nn) return null;
  const th = formatLogEta(nn.threshold);
  if (nn.linked) {
    return `Its nearest earlier neighbour is close enough in time, distance and magnitude to be its parent: log₁₀ η = ${formatLogEta(nn.log_eta)}, below the threshold of ${th}.`;
  }
  const starts = family.size > 1 ? 'so it is the first event of its family' : 'so it stands alone';
  if (nn.log_eta == null) return `No earlier event comes anywhere near the threshold of ${th}, ${starts}.`;
  return `Its nearest earlier neighbour is too far away to be its parent (log₁₀ η = ${formatLogEta(nn.log_eta)}, threshold ${th}), ${starts}.`;
}

export function plural(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
}

/** `10^-5.75` written with a real minus sign, for the proximity threshold. */
export function formatLogEta(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2).replace('-', '−');
}
