export interface PromptComponent {
  id: string;
  name: string;
  layer: string;
  priority: number;
  estimatedTokens: number;
  enabled: boolean;
  scenes?: string[];
  complexity?: string[];
  content: string;
  dynamic?: boolean;
  match?: {
    keywords: string;
    description: string;
  };
}

export type LayerType = 'L0' | 'L1' | 'L2' | 'L3' | 'all';

export interface CreateForm {
  id: string;
  name: string;
  priority: number;
  keywords: string;
  description: string;
  content: string;
}
