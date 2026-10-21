export class ApproveAdminProposalCommand {
  constructor(readonly id: string, readonly wallet: string, readonly requestId: string | null) {}
}

export interface ApprovedProposalDto {
  ok: true;
  status: 'applied';
  id: string;
}
