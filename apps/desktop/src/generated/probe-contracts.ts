// 自动生成：scripts/m0/export_contracts.py；不要手工修改。
export interface RuntimeConnection { base_url: string; token: string; protocol_version: 1 }
export interface Root { run_id: string; task_id: string }
export type Fixture = 'complete' | 'gated' | 'uncertain_write';
export interface Receipt { run_id: string; task_id: string; [key: string]: unknown }
export interface RunEvent { seq: number; [key: string]: unknown }
