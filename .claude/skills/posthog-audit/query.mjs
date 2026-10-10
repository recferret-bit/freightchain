import { DATE_RANGE } from './spec.mjs';

const filter = (p) => ({ key: p.key, type: 'event', operator: p.operator, value: p.value });

function eventsNode(step, { math, math_property } = {}) {
  const node = {
    kind: 'EventsNode',
    event: step.event,
    name: step.event,
    properties: (step.properties ?? []).map(filter),
  };
  if (math) node.math = math;
  if (math_property) node.math_property = math_property;
  return node;
}

function breakdownFilter(item) {
  if (item.breakdowns) return { breakdowns: item.breakdowns.map((property) => ({ type: 'event', property })) };
  if (item.breakdown) return { breakdown: item.breakdown, breakdown_type: 'event' };
  return null;
}

/** The InsightVizNode this spec row should store. */
export function buildQuery(item) {
  const dateRange = item.dateRange ?? DATE_RANGE;
  let source;
  if (item.kind === 'TrendsQuery') {
    source = {
      kind: 'TrendsQuery', version: 2, dateRange,
      series: item.series.map((step) => eventsNode(step, { math: item.math ?? 'total', math_property: item.math_property })),
      trendsFilter: { display: item.display, ...(item.formula ? { formula: item.formula } : {}) },
    };
  } else if (item.kind === 'FunnelsQuery') {
    source = {
      kind: 'FunnelsQuery', version: 2, dateRange,
      series: item.series.map((step) => eventsNode(step)),
      funnelsFilter: {
        funnelVizType: 'steps',
        funnelOrderType: 'ordered',
        funnelWindowInterval: item.window.interval,
        funnelWindowIntervalUnit: item.window.unit,
        ...(item.exclusions ? {
          exclusions: item.exclusions.map((ex) => ({
            kind: 'EventsNode', event: ex.event, name: ex.event, funnelFromStep: ex.from, funnelToStep: ex.to,
          })),
        } : {}),
      },
    };
  } else if (item.kind === 'RetentionQuery') {
    source = {
      kind: 'RetentionQuery', version: 2, dateRange,
      properties: (item.properties ?? []).map(filter),
      retentionFilter: {
        period: item.period,
        retentionType: 'retention_first_time',
        totalIntervals: 8,
        targetEntity: { id: item.target, type: 'events' },
        returningEntity: { id: item.returning, type: 'events' },
      },
    };
  } else if (item.kind === 'PathsQuery') {
    source = {
      kind: 'PathsQuery', version: 2, dateRange,
      properties: (item.properties ?? []).map(filter),
      pathsFilter: {
        includeEventTypes: ['custom_event'],
        startPoint: item.start,
        stepLimit: item.stepLimit ?? 5,
        edgeLimit: 50,
        excludeEvents: ['$pageview', '$pageleave', '$autocapture', '$identify'],
      },
    };
  } else if (item.kind === 'StickinessQuery') {
    source = {
      kind: 'StickinessQuery', version: 2, dateRange, interval: 'day',
      series: item.series.map((step) => eventsNode(step, { math: item.math ?? 'dau' })),
      stickinessFilter: { display: 'ActionsBar' },
    };
  } else if (item.kind === 'LifecycleQuery') {
    source = {
      kind: 'LifecycleQuery', version: 2, dateRange, interval: 'day',
      series: item.series.map((step) => eventsNode(step)),
    };
  } else {
    throw new Error(`unknown kind ${item.kind}`);
  }
  const breakdown = breakdownFilter(item);
  if (breakdown) source.breakdownFilter = breakdown;
  return { kind: 'InsightVizNode', source };
}

export function eventsOf(series = []) {
  const out = [];
  for (const node of series) {
    if (node?.kind === 'GroupNode') for (const child of node.nodes ?? []) out.push(child.event ?? null);
    else out.push(node?.event ?? null);
  }
  return out;
}

export function specEvents(item) {
  if (item.kind === 'RetentionQuery') return [item.target, item.returning];
  if (item.kind === 'PathsQuery') return [item.start];
  return (item.series ?? []).map((step) => step.event);
}
