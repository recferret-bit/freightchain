// Facts only. Unknown provider data must never read like a successful anti-fraud check.
export function networkEvidenceText(e) {
  if (!e) return 'not recorded';
  if (e.status !== 'observed') return e.status;
  return `${e.asn ?? 'unknown ASN'} · ${e.excluded === 'mobile' ? 'mobile — excluded from cluster evidence' : 'non-mobile'}${e.hosting ? ' · hosting' : ''}${e.anonymous ? ' · anonymous network' : ''}`;
}
export function fundingEvidenceText(e) {
  if (!e) return 'Funding: not recorded';
  if (e.funder) return `Funding: ${e.status} · ${e.funder.wallet} · ${e.excluded === 'exchange' ? 'exchange — excluded from shared-funder evidence' : e.funder.type ?? 'unknown type'}`;
  return `Funding: ${e.status} · ${e.transfers?.length ?? 0} observed transfers${e.complete ? ' · returned history complete' : ' · history incomplete or unavailable'}. First funder unknown.`;
}
