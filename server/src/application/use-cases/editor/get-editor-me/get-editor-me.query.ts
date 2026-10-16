export interface EditorProviderDto {
  id: string;
  label: string;
  models: string[];
  default: string;
}

export interface EditorMeDto {
  wallet: string;
  /** the AI providers whose key is set ([] until the AI editor is configured) */
  providers: EditorProviderDto[];
  defaultProvider: string | null;
}

export class GetEditorMeQuery {
  constructor(public readonly wallet: string) {}
}
