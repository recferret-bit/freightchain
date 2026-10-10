/** Desired PostHog insights for project 297915. posthog-audit and posthog-map both read this.
 *  pin: true belongs on dashboard 1006663. Everything else is saved and left off that board.
 *  Property values are the strings the PostHog UI stores (`"true"`, `"server"`). */

export const PROJECT_ID = 297915;
export const HOST = 'https://eu.posthog.com';
export const DASHBOARD_ID = 1006663;
export const DATE_RANGE = { date_from: '2026-10-08', date_to: '2026-10-12', explicitDate: true };

const S = { key: 'source', operator: 'exact', value: ['server'] };
const demo = (on) => ({ key: 'is_demo', operator: 'exact', value: [on ? 'true' : 'false'] });
const free = (on) => ({ key: 'is_free', operator: 'exact', value: [on ? 'true' : 'false'] });
const notProbe = { key: 'surface', operator: 'is_not', value: ['prod-check'] };
const tabNew = { key: 'tab', operator: 'exact', value: ['new'] };
const step = (event, properties = []) => ({ event, properties });

const fair = '8 Oct 2026–12 Oct 2026 UTC.';

export const insights = [
  trend('wallets-real', 'FC · Wallets (real)', true, 'BoldNumber', [step('player_signed_in', [S, demo(false)])], 'dau', `Unique wallets. ${fair}`),
  trend('confirms-real', 'FC · Paid confirms (real)', true, 'BoldNumber', [step('payment_confirmed', [S, demo(false)])], 'total', 'Memo SOL confirms. A ticket buy is ride_ordered, not this event.'),
  trend('starts-real', 'FC · Starts (real)', true, 'BoldNumber', [step('ride_started', [S, demo(false)])], 'total', fair),
  trend('completes-real', 'FC · Completes (real)', true, 'BoldNumber', [step('ride_completed', [S, demo(false)])], 'total', 'North star. No round_id filter. Free finishes have no round.'),
  trend('wallets-demo', 'FC · Wallets (demo ×60)', true, 'BoldNumber', [step('player_signed_in', [S, demo(true)])], 'dau', 'Demo wallet. Clock ×60.'),
  trend('confirms-demo', 'FC · Paid confirms (demo ×60)', true, 'BoldNumber', [step('payment_confirmed', [S, demo(true)])], 'total', 'Demo wallet. Clock ×60.'),
  trend('starts-demo', 'FC · Starts (demo ×60)', true, 'BoldNumber', [step('ride_started', [S, demo(true)])], 'total', 'Demo wallet. Clock ×60.'),
  trend('completes-demo', 'FC · Completes (demo ×60)', true, 'BoldNumber', [step('ride_completed', [S, demo(true)])], 'total', 'Demo wallet. Clock ×60.'),
  formula('completion-real', 'FC · Completion rate (real)', true, 'ride_completed', 'ride_started', [S, demo(false)], 'Count of completes divided by count of starts. Same is_demo on both.'),
  formula('completion-paid-real', 'FC · Completion rate (paid, real)', true, 'ride_completed', 'ride_started', [S, demo(false), free(false)], 'Paid shifts only.'),
  {
    id: 'lamports', name: 'FC · Lamports this round', pin: true, kind: 'TrendsQuery', display: 'BoldNumber', math: 'sum', math_property: 'lamports',
    series: [step('payment_confirmed', [S, { key: 'round_id', operator: 'is_set', value: [] }])],
    caption: 'Sum of lamports. Site hero is split.grand, not this sum. If it disagrees with economy."Payment", quote the SQL.',
  },
  bar('rejected', 'FC · payment_rejected by reason', true, 'payment_rejected', 'reason_code'),
  bar('failed', 'FC · ride_failed by fail_code', true, 'ride_failed', 'fail_code'),
  funnel('free-real', 'FC · Free activation (real)', true, { interval: 7, unit: 'day' }, [
    step('lobby_tab_viewed', [tabNew]),
    step('ride_buy_clicked', [free(true), demo(false)]),
    step('ride_ordered', [S, free(true), demo(false)]),
    step('ride_started', [S, demo(false)]),
    step('ride_completed', [S, demo(false)]),
  ], 'Free run is 60 seconds and 420 m and ends itself. No tier click.'),
  funnel('free-demo', 'FC · Free activation (demo ×60)', true, { interval: 7, unit: 'day' }, [
    step('lobby_tab_viewed', [tabNew]),
    step('ride_buy_clicked', [free(true), demo(true)]),
    step('ride_ordered', [S, free(true), demo(true)]),
    step('ride_started', [S, demo(true)]),
    step('ride_completed', [S, demo(true)]),
  ], 'Demo wallet. Clock ×60.'),
  funnel('paid-real', 'FC · Paid activation (real)', true, { interval: 7, unit: 'day' }, [
    step('lobby_tab_viewed', [tabNew]),
    step('ride_buy_clicked', [free(false), demo(false)]),
    step('ride_ordered', [S, free(false), demo(false)]),
    step('payment_confirmed', [S, demo(false)]),
    step('ride_started', [S, demo(false)]),
    step('ride_completed', [S, demo(false)]),
  ], 'A real 1 h shift does not finish in one sitting. payment_confirmed is memo SOL.'),
  funnel('paid-demo', 'FC · Paid activation (demo ×60)', true, { interval: 7, unit: 'day' }, [
    step('lobby_tab_viewed', [tabNew]),
    step('ride_buy_clicked', [free(false), demo(true)]),
    step('ride_ordered', [S, free(false), demo(true)]),
    step('payment_confirmed', [S, demo(true)]),
    step('ride_started', [S, demo(true)]),
    step('ride_completed', [S, demo(true)]),
  ], 'Demo wallet finishes in about a minute. Say demo clock ×60 on the video.'),
  funnel('pay-real', 'FC · Payment (real)', true, { interval: 30, unit: 'minute' }, [
    step('ride_buy_clicked', [free(false), demo(false)]),
    step('payment_submitted'),
    step('payment_confirmed', [S, demo(false)]),
  ], 'Quote TTL is 10 minutes. The window is 30.'),
  funnel('pay-demo', 'FC · Payment (demo ×60)', true, { interval: 30, unit: 'minute' }, [
    step('ride_buy_clicked', [free(false), demo(true)]),
    step('payment_submitted'),
    step('payment_confirmed', [S, demo(true)]),
  ], 'Demo copy of the payment funnel.'),
  funnel('reconcile', 'FC · Gave up, then reconcile', false, { interval: 7, unit: 'day' }, [
    step('payment_confirm_gave_up'),
    step('payment_confirmed', [S, { key: 'via', operator: 'exact', value: ['reconcile'] }]),
  ], 'Saved, off the judge board until a give-up has been ingested.'),
  {
    ...funnel('free-vs-paid', 'FC · Free vs paid', true, { interval: 7, unit: 'day' }, [
      step('ride_started', [S, demo(false)]),
      step('ride_completed', [S, demo(false)]),
    ], 'Breakdown is_free. One is_demo on both steps.'),
    breakdown: 'is_free',
  },
  funnel('acq-1h', 'FC · Acquisition (1 hour)', false, { interval: 1, unit: 'hour' }, [
    step('landing_viewed', [notProbe]),
    step('wallet_connect_clicked'),
    step('player_signed_in', [S]),
    step('lobby_viewed'),
  ], 'Unpublished until one real session_restored shows the anon id and the wallet as one person. Steps 2 and 3 join only via $create_alias.'),
  funnel('acq-24h', 'FC · Acquisition (24 hours)', false, { interval: 24, unit: 'hour' }, [
    step('landing_viewed', [notProbe]),
    step('wallet_connect_clicked'),
    step('player_signed_in', [S]),
    step('lobby_viewed'),
  ], 'The 24 hour copy. A 7 day acquisition window is wrong.'),
  funnel('signature', 'FC · Signature', false, { interval: 15, unit: 'minute' }, [
    step('wallet_connect_clicked'),
    step('wallet_signature_requested'),
    step('player_signed_in', [S]),
  ], 'Off the judge board.'),
  {
    ...funnel('sign-fail', 'FC · Sign-in failed', false, { interval: 15, unit: 'minute' }, [
      step('wallet_connect_clicked'),
      step('sign_in_failed'),
    ], 'Exclusion: player_signed_in between the steps. Breakdown stage.'),
    breakdown: 'stage',
    exclusions: [{ event: 'player_signed_in', from: 0, to: 1 }],
  },
  funnel('restore-landing', 'FC · Session restore (landing)', false, { interval: 1, unit: 'hour' }, [
    step('landing_viewed', [notProbe]),
    step('session_restored', [{ key: 'surface', operator: 'exact', value: ['landing'] }]),
    step('lobby_open_clicked'),
  ], 'Step 3 is lobby_open_clicked, not play_top_clicked.'),
  funnel('restore-lobby', 'FC · Session restore (lobby)', false, { interval: 1, unit: 'hour' }, [
    step('session_restored', [{ key: 'surface', operator: 'exact', value: ['lobby'] }]),
    step('lobby_viewed'),
  ], 'Someone who opens the lobby URL never hits the landing funnel.'),
  funnel('return', 'FC · Weekly return', false, { interval: 7, unit: 'day' }, [
    step('ride_completed', [S]),
    step('lobby_viewed'),
    step('ride_started', [S]),
  ], 'A definition, not a slide, until someone comes back.'),
  funnel('promo-viewed', 'FC · Promo from an invite view', false, { interval: 7, unit: 'day' }, [
    step('promo_invite_viewed'),
    step('player_signed_in', [S]),
    step('lobby_tab_viewed', [{ key: 'tab', operator: 'exact', value: ['promo'] }]),
    step('promo_redeem_clicked', [{ key: 'prefilled', operator: 'exact', value: ['true'] }]),
    step('promo_redeemed', [S]),
  ], 'PostHog cannot OR a step, so the submitted-code path is a second funnel.'),
  funnel('promo-submitted', 'FC · Promo from a submitted code', false, { interval: 7, unit: 'day' }, [
    step('promo_invite_submitted'),
    step('player_signed_in', [S]),
    step('lobby_tab_viewed', [{ key: 'tab', operator: 'exact', value: ['promo'] }]),
    step('promo_redeem_clicked'),
    step('promo_redeemed', [S]),
  ], 'The second promo entrance.'),
  funnel('promo-ride', 'FC · Promo to a finish', false, { interval: 7, unit: 'day' }, [
    step('promo_redeemed', [S]),
    step('ride_started', [S]),
    step('ride_completed', [S]),
  ], 'Does a redeemed code turn into a finished shift?'),
  {
    id: 'retention', name: 'FC · Retention (finish → next start)', pin: false, kind: 'RetentionQuery',
    period: 'Day', target: 'ride_completed', returning: 'ride_started',
    properties: [S, demo(false)],
    caption: 'Off the judge board. Day 0 is a finish. Day 1 is a later UTC day.',
  },
  {
    id: 'path-client', name: 'FC · Path (client)', pin: false, kind: 'PathsQuery',
    start: 'landing_viewed', stepLimit: 5,
    caption: 'Custom events only. The anon id and the wallet are different persons until the alias check. Off the judge board.',
  },
  {
    id: 'path-server-real', name: 'FC · Path (server, real)', pin: false, kind: 'PathsQuery',
    start: 'ride_ordered', stepLimit: 5, properties: [S, demo(false)],
    caption: 'Server persons only. Off the judge board.',
  },
  {
    id: 'path-server-demo', name: 'FC · Path (server, demo)', pin: false, kind: 'PathsQuery',
    start: 'ride_ordered', stepLimit: 5, properties: [S, demo(true)],
    caption: 'Demo wallet path. Off the judge board.',
  },
  {
    id: 'stickiness', name: 'FC · Stickiness (starts)', pin: false, kind: 'StickinessQuery',
    series: [step('ride_started', [S, demo(false)])], math: 'dau',
    caption: 'Off the judge board. One shift in this fair sits on 1 day.',
  },
  {
    id: 'lifecycle', name: 'FC · Lifecycle (sign-ins)', pin: false, kind: 'LifecycleQuery',
    series: [step('player_signed_in', [S, demo(false)])],
    caption: 'Off the judge board. New means the first server sign-in since capture started.',
  },
  {
    id: 'page-speed', name: 'Page speed', pin: false, kind: 'TrendsQuery', display: 'ActionsBar', math: 'total',
    series: [step('web_vital', [{ key: 'metric', operator: 'exact', value: ['LCP', 'CLS', 'FCP', 'INP', 'TTFB'] }])],
    breakdowns: ['metric', 'rating'],
    caption: 'One series. Breakdown metric, then rating. Do not pin this to dashboard 1006663.',
  },
];

function trend(id, name, pin, display, series, math, caption) {
  return { id, name, pin, kind: 'TrendsQuery', display, series, math, caption };
}
function formula(id, name, pin, a, b, properties, caption) {
  return {
    id, name, pin, kind: 'TrendsQuery', display: 'BoldNumber', formula: 'A/B', caption,
    series: [step(a, properties), step(b, properties)],
  };
}
function bar(id, name, pin, event, breakdown) {
  return {
    id, name, pin, kind: 'TrendsQuery', display: 'ActionsBar', math: 'total', breakdown, caption: `Breakdown ${breakdown}.`,
    series: [step(event, [S])],
  };
}
function funnel(id, name, pin, window, series, caption) {
  return { id, name, pin, kind: 'FunnelsQuery', window, series, caption };
}
